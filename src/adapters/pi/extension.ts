import { randomUUID } from "node:crypto";
import type { LearningLoop } from "../../core/learningLoop.js";
import {
  type ProjectIdentityOverrides,
  resolveProjectIdentity,
} from "../../core/projectIdentity.js";
import type { TraceScope } from "../../core/types.js";
import type {
  PiBeforeAgentStartEvent,
  PiInputEvent,
  PiLikeApi,
  PiToolCallEvent,
  PiToolResultEvent,
  PiTurnEndEvent,
  PiTurnStartEvent,
} from "./types.js";

interface ToolCallState {
  toolName: string;
  input: Record<string, unknown>;
}

export interface PiTraceExtensionOptions {
  loop: LearningLoop;
  scope?: TraceScope;
  harnessName?: string;
  agentId?: string;
  sessionId?: string;
  maxSuggestions?: number;
  customMessageType?: string;
  projectIdentity?: ProjectIdentityOverrides;
}

function nowIso(): string {
  return new Date().toISOString();
}

function extractText(result: PiToolResultEvent): string {
  const textFromContent = (result.content ?? [])
    .map((chunk) => chunk.text)
    .join("\n")
    .trim();

  if (textFromContent) {
    return textFromContent;
  }

  if (result.details) {
    try {
      return JSON.stringify(result.details);
    } catch {
      return "";
    }
  }

  return "";
}

function commandFromInput(input: Record<string, unknown>): string | undefined {
  const command = input.command;
  if (typeof command === "string") {
    return command;
  }
  return undefined;
}

function swebenchInstanceIdFromSessionId(sessionId: string): string | null {
  const parts = sessionId.split("::");
  if (parts.length !== 3 && parts.length !== 4) {
    return null;
  }

  if (parts[0] !== "swebench") {
    return null;
  }

  const instanceId = parts[1]?.trim() ?? "";
  if (!instanceId) {
    return null;
  }

  return instanceId;
}

function firstPlaybookAction(playbookMarkdown: string): string | null {
  const firstLine = playbookMarkdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return null;
  }

  const withoutPrefix = firstLine.startsWith("- ") ? firstLine.slice(2) : firstLine;
  return withoutPrefix.trim() || null;
}

export function createPiTraceExtension(
  options: PiTraceExtensionOptions,
): (pi: PiLikeApi) => void {
  const loop = options.loop;
  const scope = options.scope ?? "personal";
  const harness = options.harnessName ?? "pi";
  const agentId = options.agentId;
  const maxSuggestions = options.maxSuggestions ?? 3;
  const projectIdentity = resolveProjectIdentity(options.projectIdentity);
  const customMessageType =
    options.customMessageType ?? projectIdentity.extensionCustomType;

  const sessionId = options.sessionId ?? randomUUID();
  const turnStartTimes = new Map<number, number>();
  const toolCalls = new Map<string, ToolCallState>();
  let latestUserInputEventId: string | null = null;

  async function ingest(event: {
    type:
      | "user_input"
      | "tool_call"
      | "tool_result"
      | "turn_summary"
      | "feedback"
      | "checkpoint"
      | "assistant_output";
    payload: Record<string, unknown>;
    tags?: string[];
    metrics?: {
      latencyMs?: number;
      outcome?: "success" | "failure" | "unknown";
      tokens?: {
        inputUncached?: number;
        inputCached?: number;
        output?: number;
        cacheWrite?: number;
      };
      cost?: {
        usd?: number;
      };
    };
  }): Promise<string> {
    const eventId = randomUUID();
    await loop.ingest({
      id: eventId,
      timestamp: nowIso(),
      sessionId,
      agentId,
      harness,
      scope,
      type: event.type,
      payload: event.payload,
      tags: event.tags,
      metrics: event.metrics,
    });
    return eventId;
  }

  return (pi: PiLikeApi) => {
    pi.on("input", async (rawEvent) => {
      const event = rawEvent as PiInputEvent;
      latestUserInputEventId = await ingest({
        type: "user_input",
        payload: {
          text: event.text,
          source: event.source ?? "interactive",
        },
      });
    });

    pi.on("tool_call", async (rawEvent) => {
      const event = rawEvent as PiToolCallEvent;
      toolCalls.set(event.toolCallId, {
        toolName: event.toolName,
        input: event.input,
      });

      await ingest({
        type: "tool_call",
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          command: commandFromInput(event.input),
        },
      });
    });

    pi.on("tool_result", async (rawEvent) => {
      const event = rawEvent as PiToolResultEvent;
      const call = toolCalls.get(event.toolCallId);
      const text = extractText(event);
      const isError = event.isError === true;

      await ingest({
        type: "tool_result",
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          command: call ? commandFromInput(call.input) : undefined,
          isError,
          text,
          input: event.input,
        },
        metrics: {
          outcome: isError ? "failure" : "success",
        },
      });
    });

    pi.on("turn_start", (rawEvent) => {
      const event = rawEvent as PiTurnStartEvent;
      turnStartTimes.set(event.turnIndex, Date.now());
    });

    pi.on("turn_end", async (rawEvent) => {
      const event = rawEvent as PiTurnEndEvent;
      const startedAt = turnStartTimes.get(event.turnIndex) ?? Date.now();
      const usage = event.message?.usage;

      await ingest({
        type: "turn_summary",
        payload: {
          turnIndex: event.turnIndex,
        },
        metrics: {
          latencyMs: Date.now() - startedAt,
          tokens: {
            inputUncached: usage?.input,
            inputCached: usage?.cacheRead,
            output: usage?.output,
            cacheWrite: usage?.cacheWrite,
          },
          cost: {
            usd: usage?.cost?.total,
          },
        },
      });
    });

    pi.on("before_agent_start", async (rawEvent) => {
      const event = rawEvent as PiBeforeAgentStartEvent;

      if (maxSuggestions <= 0) {
        await ingest({
          type: "checkpoint",
          payload: {
            kind: "happy_paths_prior_hints",
            retrievalScope: "disabled",
            fallbackToGlobalToolResults: false,
            hintCount: 0,
            selfFilteredHintCount: 0,
            hintIds: [],
            hintTitles: [],
          },
          tags: ["happy_paths", "prior_hints"],
        });
        return undefined;
      }

      const swebenchInstanceId = swebenchInstanceIdFromSessionId(sessionId);
      const scopedFilters: Record<string, string> = {
        eventType: "tool_result",
      };
      if (swebenchInstanceId) {
        scopedFilters.swebenchInstanceId = swebenchInstanceId;
      }

      let fallbackToGlobalToolResults = false;
      let suggestions = await loop.suggest({
        text: event.prompt,
        limit: maxSuggestions + 2,
        filters: scopedFilters,
      });

      if (suggestions.length === 0 && swebenchInstanceId) {
        fallbackToGlobalToolResults = true;
        suggestions = await loop.suggest({
          text: event.prompt,
          limit: maxSuggestions + 2,
          filters: {
            eventType: "tool_result",
          },
        });
      }

      const nonSelfSuggestions = suggestions.filter((suggestion) => {
        if (!latestUserInputEventId) {
          return true;
        }
        return !suggestion.evidenceEventIds.includes(latestUserInputEventId);
      });

      const rankedSuggestions = [...nonSelfSuggestions].sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }
        return left.id.localeCompare(right.id);
      });

      const topSuggestions = rankedSuggestions.slice(0, maxSuggestions);
      await ingest({
        type: "checkpoint",
        payload: {
          kind: "happy_paths_prior_hints",
          retrievalScope: swebenchInstanceId ? "swebench_instance" : "global",
          fallbackToGlobalToolResults,
          hintCount: topSuggestions.length,
          selfFilteredHintCount: Math.max(
            0,
            suggestions.length - nonSelfSuggestions.length,
          ),
          hintIds: topSuggestions.map((suggestion) => suggestion.id),
          hintTitles: topSuggestions.map((suggestion) =>
            suggestion.title.slice(0, 160),
          ),
        },
        tags: ["happy_paths", "prior_hints"],
      });

      if (topSuggestions.length === 0) {
        return undefined;
      }

      const rendered = topSuggestions
        .map((suggestion, index) => {
          const confidencePct = Math.round(Math.max(0, suggestion.confidence) * 100);
          const action = firstPlaybookAction(suggestion.playbookMarkdown);
          const clippedAction =
            action && action.length > 120 ? `${action.slice(0, 119)}…` : action;
          const actionSuffix = clippedAction ? ` Action: ${clippedAction}` : "";
          return `${index + 1}. ${suggestion.rationale} (confidence ${confidencePct}%).${actionSuffix}`;
        })
        .join("\n");

      return {
        message: {
          customType: customMessageType,
          content: `Prior trace hints:\n${rendered}`,
          display: true,
        },
      };
    });
  };
}
