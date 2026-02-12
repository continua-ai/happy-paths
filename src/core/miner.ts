import type { TraceMiner } from "./interfaces.js";
import { areNearDuplicate } from "./nearDup.js";
import {
  extractErrorSignatures,
  normalizeCommandSignature,
  normalizeText,
} from "./signatures.js";
import type { MinedArtifact, TraceEvent } from "./types.js";

interface ToolOutcome {
  event: TraceEvent;
  isError: boolean;
  command: string;
  text: string;
}

interface ArtifactAccumulator {
  failureSignature: string;
  successSignature: string;
  supportCount: number;
  supportSessionIds: Set<string>;
  evidenceEventIds: string[];
}

const LOOKAHEAD_RESULTS = 6;

function payloadText(payload: Record<string, unknown>): string {
  const candidates: unknown[] = [
    payload.output,
    payload.stderr,
    payload.stdout,
    payload.text,
    payload.content,
    payload.error,
    payload.message,
  ];

  const firstText = candidates.find((item) => typeof item === "string");
  if (typeof firstText === "string") {
    return firstText;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

function toToolOutcome(event: TraceEvent): ToolOutcome | null {
  if (event.type !== "tool_result") {
    return null;
  }

  const isError =
    event.metrics?.outcome === "failure" || event.payload.isError === true;

  const commandValue = event.payload.command;
  const command = typeof commandValue === "string" ? commandValue : "";

  return {
    event,
    isError,
    command,
    text: payloadText(event.payload),
  };
}

export class SimpleWrongTurnMiner implements TraceMiner {
  private readonly eventsBySession = new Map<string, TraceEvent[]>();

  async ingest(event: TraceEvent): Promise<void> {
    const bucket = this.eventsBySession.get(event.sessionId) ?? [];
    bucket.push(event);
    this.eventsBySession.set(event.sessionId, bucket);
  }

  async mine(limit = 50): Promise<MinedArtifact[]> {
    const byFingerprint = new Map<string, ArtifactAccumulator>();

    for (const [sessionId, events] of this.eventsBySession.entries()) {
      const toolResults = events
        .map((event) => toToolOutcome(event))
        .filter((event): event is ToolOutcome => event !== null);

      for (let index = 0; index < toolResults.length; index += 1) {
        const current = toolResults[index];
        if (!current || !current.isError) {
          continue;
        }

        const failureSignature = this.failureSignature(current);
        if (!failureSignature) {
          continue;
        }

        for (
          let lookahead = index + 1;
          lookahead < toolResults.length && lookahead <= index + LOOKAHEAD_RESULTS;
          lookahead += 1
        ) {
          const candidate = toolResults[lookahead];
          if (!candidate || candidate.isError) {
            continue;
          }

          if (this.isUnchangedRetry(current, candidate)) {
            continue;
          }

          const successSignature = this.successSignature(candidate);
          if (!successSignature) {
            continue;
          }

          const fingerprint = `${failureSignature}=>${successSignature}`;
          const existing = byFingerprint.get(fingerprint);
          if (existing) {
            existing.supportCount += 1;
            existing.supportSessionIds.add(sessionId);

            for (const eventId of [current.event.id, candidate.event.id]) {
              if (existing.evidenceEventIds.includes(eventId)) {
                continue;
              }
              existing.evidenceEventIds.push(eventId);
              if (existing.evidenceEventIds.length >= 8) {
                break;
              }
            }
          } else {
            byFingerprint.set(fingerprint, {
              failureSignature,
              successSignature,
              supportCount: 1,
              supportSessionIds: new Set([sessionId]),
              evidenceEventIds: [current.event.id, candidate.event.id],
            });
          }

          break;
        }
      }
    }

    const artifacts = [...byFingerprint.values()]
      .map((entry) => {
        const supportSessionCount = entry.supportSessionIds.size;
        const supportCountWeight = Math.min(1, (entry.supportCount - 1) / 4);
        const supportSessionWeight = Math.min(1, (supportSessionCount - 1) / 2);
        const confidence = Math.min(
          0.9,
          0.45 + supportCountWeight * 0.2 + supportSessionWeight * 0.25,
        );

        return {
          id: `artifact-${entry.failureSignature}-${entry.successSignature}`,
          kind: "wrong_turn_fix" as const,
          summary: `When you hit "${entry.failureSignature}", prefer "${entry.successSignature}".`,
          confidence,
          evidenceEventIds: entry.evidenceEventIds,
          metadata: {
            failureSignature: entry.failureSignature,
            successSignature: entry.successSignature,
            supportCount: entry.supportCount,
            supportSessionCount,
            crossSessionSupport: supportSessionCount >= 2,
          },
        } satisfies MinedArtifact;
      })
      .sort((left, right) => {
        const leftSessionSupport =
          typeof left.metadata?.supportSessionCount === "number"
            ? left.metadata.supportSessionCount
            : 0;
        const rightSessionSupport =
          typeof right.metadata?.supportSessionCount === "number"
            ? right.metadata.supportSessionCount
            : 0;
        if (rightSessionSupport !== leftSessionSupport) {
          return rightSessionSupport - leftSessionSupport;
        }

        const leftSupport =
          typeof left.metadata?.supportCount === "number"
            ? left.metadata.supportCount
            : 0;
        const rightSupport =
          typeof right.metadata?.supportCount === "number"
            ? right.metadata.supportCount
            : 0;
        if (rightSupport !== leftSupport) {
          return rightSupport - leftSupport;
        }

        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }

        return left.id.localeCompare(right.id);
      });

    return artifacts.slice(0, limit);
  }

  private failureSignature(outcome: ToolOutcome): string {
    const fromCommand = normalizeCommandSignature(outcome.command);
    if (fromCommand) {
      return fromCommand;
    }

    const errorSignatures = extractErrorSignatures(outcome.text, 1);
    return errorSignatures[0] ?? normalizeText(outcome.text).slice(0, 120);
  }

  private successSignature(outcome: ToolOutcome): string {
    const command = normalizeCommandSignature(outcome.command);
    if (command) {
      return command;
    }

    return normalizeText(outcome.text).slice(0, 120);
  }

  private isUnchangedRetry(failure: ToolOutcome, success: ToolOutcome): boolean {
    const failureCommand = failure.command.trim();
    const successCommand = success.command.trim();

    if (!failureCommand || !successCommand) {
      return false;
    }

    if (failureCommand === successCommand) {
      return true;
    }

    return areNearDuplicate(failureCommand, successCommand, 0.95);
  }
}
