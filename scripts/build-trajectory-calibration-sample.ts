#!/usr/bin/env node

import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type JsonRecord = Record<string, unknown>;

type Format = "auto" | "trace" | "pi";

type Scope = "personal" | "team" | "public";

type ParsedOptions = {
  traceRoot: string;
  format: Format;
  toolName: string;
  harness: string;
  scope: Scope;
  minSessionDurationMs: number;
  minTotalLatencyMs: number;
  minToolResultCount: number;
  evalRatio: number;
  sampleSize: number;
  maxOutputChars: number;
  seed: number;
  json: boolean;
  out: string;
};

type SessionEnvelope = {
  sessionId: string;
  events: Array<Record<string, unknown>>;
  traceFiles: Set<string>;
};

type PredictedIssueKind =
  | "benign_probe"
  | "transient_external"
  | "command_mismatch"
  | "environment_mismatch"
  | "missing_context"
  | "unknown_failure";

type CalibrationSampleRow = {
  id: string;
  episodeId: string;
  familySignature: string;
  sessionId: string;
  startedAt: string;
  predicted: {
    issueKind: PredictedIssueKind;
    harmful: boolean;
    confidence: number;
    abstained: boolean;
    reason: string;
  };
  outcome: {
    retries: number;
    wallTimeMs: number;
    tokenCount: number;
    tokenProxy: number;
    costUsd: number;
    success: boolean;
  };
  snippets: {
    command: string;
    outputFirstLine: string;
  };
  manualLabel: {
    issueKind: PredictedIssueKind | null;
    harmful: boolean | null;
    notes: string;
  };
};

const HARMFUL_KINDS = new Set<string>([
  "command_mismatch",
  "environment_mismatch",
  "missing_context",
]);

function parseFloatOrUndefined(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid number: ${value}`);
  }
  return parsed;
}

function parseIntOrUndefined(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid integer: ${value}`);
  }
  return parsed;
}

function parseFormat(value: string): Format {
  if (value === "auto" || value === "trace" || value === "pi") {
    return value;
  }
  throw new Error(`invalid --format value: ${value}`);
}

function parseScope(value: string): Scope {
  if (value === "personal" || value === "team" || value === "public") {
    return value;
  }
  throw new Error(`invalid --scope value: ${value}`);
}

function normalizeEvalRatio(value: number | undefined): number {
  if (value === undefined) {
    return 0.3;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`invalid eval ratio: ${value}`);
  }
  return Math.max(0.05, Math.min(0.95, value));
}

function parseArgs(argv: string[]): ParsedOptions {
  const options: ParsedOptions = {
    traceRoot: ".happy-paths",
    format: "auto",
    toolName: "bash",
    harness: "pi",
    scope: "personal",
    minSessionDurationMs: 15 * 60 * 1000,
    minTotalLatencyMs: 5 * 60 * 1000,
    minToolResultCount: 8,
    evalRatio: 0.3,
    sampleSize: 240,
    maxOutputChars: 240,
    seed: 31,
    json: false,
    out: ".happy-paths/trajectory-calibration/sample.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--trace-root") {
      options.traceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--format") {
      options.format = parseFormat(String(value));
      index += 1;
      continue;
    }
    if (token === "--tool-name") {
      options.toolName = String(value);
      index += 1;
      continue;
    }
    if (token === "--harness") {
      options.harness = String(value);
      index += 1;
      continue;
    }
    if (token === "--scope") {
      options.scope = parseScope(String(value));
      index += 1;
      continue;
    }
    if (token === "--min-session-duration-ms") {
      options.minSessionDurationMs = Math.max(0, parseIntOrUndefined(value) ?? 0);
      index += 1;
      continue;
    }
    if (token === "--min-total-latency-ms") {
      options.minTotalLatencyMs = Math.max(0, parseIntOrUndefined(value) ?? 0);
      index += 1;
      continue;
    }
    if (token === "--min-tool-result-count") {
      options.minToolResultCount = Math.max(1, parseIntOrUndefined(value) ?? 1);
      index += 1;
      continue;
    }
    if (token === "--eval-ratio") {
      options.evalRatio = normalizeEvalRatio(parseFloatOrUndefined(value));
      index += 1;
      continue;
    }
    if (token === "--sample-size") {
      options.sampleSize = Math.max(1, parseIntOrUndefined(value) ?? 1);
      index += 1;
      continue;
    }
    if (token === "--max-output-chars") {
      options.maxOutputChars = Math.max(40, parseIntOrUndefined(value) ?? 40);
      index += 1;
      continue;
    }
    if (token === "--seed") {
      options.seed = parseIntOrUndefined(value) ?? options.seed;
      index += 1;
      continue;
    }
    if (token === "--out") {
      options.out = String(value);
      index += 1;
      continue;
    }
    if (token === "--json") {
      options.json = true;
    }
  }

  return options;
}

async function collectJsonlFiles(rootPath: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl") {
        output.push(absolutePath);
      }
    }
  }

  await walk(rootPath);
  return output;
}

function parseJsonlRecords(raw: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as JsonRecord);
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return records;
}

function isTraceEventRecord(record: JsonRecord): boolean {
  return (
    typeof record.id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.harness === "string" &&
    typeof record.scope === "string" &&
    typeof record.type === "string" &&
    typeof record.payload === "object" &&
    record.payload !== null
  );
}

function sessionHintFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() || "session";
  return fileName.replace(/\.jsonl$/i, "");
}

function sessionTraceFileLabel(traceFiles: Set<string>): string {
  const files = [...traceFiles].sort();
  if (files.length === 0) {
    return "";
  }
  if (files.length === 1) {
    return files[0] ?? "";
  }
  const first = files[0] ?? "";
  return `${first} (+${files.length - 1} more)`;
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) {
    state = 1;
  }

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const random = createPrng(seed);
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const left = output[index];
    output[index] = output[swapIndex] as T;
    output[swapIndex] = left as T;
  }
  return output;
}

function issueKindFromEpisode(episode: Record<string, unknown>): {
  issueKind: PredictedIssueKind;
  confidence: number;
  harmful: boolean;
  abstained: boolean;
  eventId: string;
  reason: string;
} {
  const issues = Array.isArray(episode.issues)
    ? (episode.issues as Array<Record<string, unknown>>)
    : [];

  if (issues.length === 0) {
    return {
      issueKind: "unknown_failure",
      confidence: 0,
      harmful: false,
      abstained: true,
      eventId: "",
      reason: "no classified failure issues",
    };
  }

  const stats = new Map<
    PredictedIssueKind,
    { count: number; maxConfidence: number; eventId: string; reason: string }
  >();

  for (const issue of issues) {
    const kindValue = String(issue.kind ?? "unknown_failure");
    const kind = (
      kindValue === "benign_probe" ||
      kindValue === "transient_external" ||
      kindValue === "command_mismatch" ||
      kindValue === "environment_mismatch" ||
      kindValue === "missing_context" ||
      kindValue === "unknown_failure"
        ? kindValue
        : "unknown_failure"
    ) as PredictedIssueKind;

    const confidence = Number(issue.confidence ?? 0);
    const eventId = String(issue.eventId ?? "");
    const reason = String(issue.reason ?? "");

    const existing = stats.get(kind);
    if (!existing) {
      stats.set(kind, {
        count: 1,
        maxConfidence: Number.isFinite(confidence) ? confidence : 0,
        eventId,
        reason,
      });
      continue;
    }

    const candidateConfidence = Number.isFinite(confidence)
      ? confidence
      : existing.maxConfidence;
    const useCandidate = candidateConfidence >= existing.maxConfidence;

    stats.set(kind, {
      count: existing.count + 1,
      maxConfidence: useCandidate ? candidateConfidence : existing.maxConfidence,
      eventId: useCandidate && eventId ? eventId : existing.eventId,
      reason: useCandidate && reason ? reason : existing.reason,
    });
  }

  const ordered = [...stats.entries()].sort((left, right) => {
    const leftStats = left[1];
    const rightStats = right[1];

    if (leftStats.count !== rightStats.count) {
      return rightStats.count - leftStats.count;
    }
    if (leftStats.maxConfidence !== rightStats.maxConfidence) {
      return rightStats.maxConfidence - leftStats.maxConfidence;
    }
    return left[0] < right[0] ? -1 : 1;
  });

  const top = ordered[0];
  if (!top) {
    return {
      issueKind: "unknown_failure",
      confidence: 0,
      harmful: false,
      abstained: true,
      eventId: "",
      reason: "no dominant issue kind after aggregation",
    };
  }

  const issueKind = top[0];
  const issueStats = top[1];
  const harmful = HARMFUL_KINDS.has(issueKind);
  const abstained = issueKind === "unknown_failure";

  return {
    issueKind,
    confidence: issueStats.maxConfidence,
    harmful,
    abstained,
    eventId: issueStats.eventId,
    reason: issueStats.reason,
  };
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function eventSnippet(
  eventById: Map<string, Record<string, unknown>>,
  eventId: string,
  maxOutputChars: number,
): { command: string; outputFirstLine: string } {
  const event = eventById.get(eventId);
  if (!event) {
    return {
      command: "",
      outputFirstLine: "",
    };
  }

  const payload = event.payload;
  const payloadObj =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const command = String(payloadObj.command ?? "");
  const outputRaw = String(payloadObj.output ?? payloadObj.text ?? "");
  const firstLine = outputRaw.split(/\r?\n/, 1)[0] ?? "";

  return {
    command: truncate(command, Math.max(80, maxOutputChars)),
    outputFirstLine: truncate(firstLine, maxOutputChars),
  };
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSampleRow(
  episode: Record<string, unknown>,
  eventById: Map<string, Record<string, unknown>>,
  rowIndex: number,
  maxOutputChars: number,
): CalibrationSampleRow {
  const issue = issueKindFromEpisode(episode);
  const snippet = eventSnippet(eventById, issue.eventId, maxOutputChars);

  const outcome =
    episode.outcome &&
    typeof episode.outcome === "object" &&
    !Array.isArray(episode.outcome)
      ? (episode.outcome as Record<string, unknown>)
      : {};

  return {
    id: `calib-${String(rowIndex + 1).padStart(4, "0")}`,
    episodeId: String(episode.id ?? ""),
    familySignature: String(episode.familySignature ?? ""),
    sessionId: String(episode.sessionId ?? ""),
    startedAt: String(episode.startedAt ?? ""),
    predicted: {
      issueKind: issue.issueKind,
      harmful: issue.harmful,
      confidence: Number(issue.confidence.toFixed(3)),
      abstained: issue.abstained,
      reason: issue.reason,
    },
    outcome: {
      retries: Math.floor(asNumber(outcome.retries)),
      wallTimeMs: asNumber(outcome.wallTimeMs),
      tokenCount: asNumber(episode.tokenCount),
      tokenProxy: asNumber(episode.tokenProxy),
      costUsd: asNumber(outcome.costUsd),
      success: Boolean(outcome.success),
    },
    snippets: snippet,
    manualLabel: {
      issueKind: null,
      harmful: null,
      notes: "",
    },
  };
}

function groupByIssueKind(
  episodes: Record<string, unknown>[],
): Map<PredictedIssueKind, Record<string, unknown>[]> {
  const groups = new Map<PredictedIssueKind, Record<string, unknown>[]>();

  for (const episode of episodes) {
    const issue = issueKindFromEpisode(episode);
    const bucket = groups.get(issue.issueKind);
    if (bucket) {
      bucket.push(episode);
      continue;
    }
    groups.set(issue.issueKind, [episode]);
  }

  return groups;
}

function stratifiedSample(
  episodes: Record<string, unknown>[],
  sampleSize: number,
  seed: number,
): Record<string, unknown>[] {
  if (episodes.length <= sampleSize) {
    return [...episodes];
  }

  const groups = groupByIssueKind(episodes);
  const keys = [...groups.keys()].sort();

  const selected: Record<string, unknown>[] = [];
  const remaining = new Map<PredictedIssueKind, Record<string, unknown>[]>();

  const basePerGroup = Math.max(1, Math.floor(sampleSize / Math.max(1, keys.length)));

  let budget = sampleSize;
  for (const [keyIndex, key] of keys.entries()) {
    const candidates = groups.get(key) ?? [];
    const shuffled = shuffle(candidates, seed + keyIndex * 9973);
    const take = Math.min(shuffled.length, basePerGroup, budget);
    selected.push(...shuffled.slice(0, take));
    remaining.set(key, shuffled.slice(take));
    budget -= take;
  }

  if (budget <= 0) {
    return shuffle(selected, seed + 17).slice(0, sampleSize);
  }

  const leftovers = [...remaining.values()].flat();
  const shuffledLeftovers = shuffle(leftovers, seed + 29);
  selected.push(...shuffledLeftovers.slice(0, budget));

  return shuffle(selected, seed + 53).slice(0, sampleSize);
}

function sampleStats(rows: CalibrationSampleRow[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.predicted.issueKind;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const output: Record<string, number> = {};
  for (const [key, value] of counts.entries()) {
    output[key] = value;
  }
  return output;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const distPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(distPath)) {
    throw new Error("dist/index.js not found. Run `npm run build` first.");
  }

  const {
    buildTraceEventsFromPiSessionRecords,
    extractTrajectoryOutcomeEpisodes,
    filterLongHorizonSessions,
    splitSessionsChronologically,
    summarizeObservedAbSession,
  } = await import(pathToFileURL(distPath).href);

  const traceRoot = resolve(process.cwd(), options.traceRoot);
  const traceFiles = await collectJsonlFiles(traceRoot);
  if (traceFiles.length === 0) {
    throw new Error(`no .jsonl files found under ${traceRoot}`);
  }

  const sessionEnvelopes = new Map<string, SessionEnvelope>();
  let traceEventFilesScanned = 0;
  let piSessionFilesScanned = 0;
  let skippedForFormat = 0;

  for (const traceFile of traceFiles) {
    const raw = await readFile(traceFile, "utf-8");
    const records = parseJsonlRecords(raw);
    if (records.length === 0) {
      continue;
    }

    const traceEvents = records.filter(isTraceEventRecord);
    const shouldUseTraceFormat =
      options.format === "trace" ||
      (options.format === "auto" && traceEvents.length > 0);

    let events: Array<Record<string, unknown>> = [];
    if (shouldUseTraceFormat) {
      if (traceEvents.length === 0) {
        skippedForFormat += 1;
        continue;
      }
      traceEventFilesScanned += 1;
      events = traceEvents;
    } else {
      piSessionFilesScanned += 1;
      events = buildTraceEventsFromPiSessionRecords(records, {
        sessionId: sessionHintFromPath(traceFile),
        harness: options.harness,
        scope: options.scope,
        toolName: options.toolName,
      });
      if (events.length === 0) {
        continue;
      }
    }

    for (const event of events) {
      const sessionId =
        typeof event.sessionId === "string" && event.sessionId.length > 0
          ? event.sessionId
          : sessionHintFromPath(traceFile);

      const existing = sessionEnvelopes.get(sessionId);
      if (existing) {
        existing.events.push(event);
        existing.traceFiles.add(traceFile);
        continue;
      }

      sessionEnvelopes.set(sessionId, {
        sessionId,
        events: [event],
        traceFiles: new Set([traceFile]),
      });
    }
  }

  const sessionSummaries = [...sessionEnvelopes.values()].map((envelope) => {
    return summarizeObservedAbSession(
      envelope.sessionId,
      sessionTraceFileLabel(envelope.traceFiles),
      envelope.events,
    );
  });

  const longHorizonSessions = filterLongHorizonSessions(sessionSummaries, {
    minSessionDurationMs: options.minSessionDurationMs,
    minTotalLatencyMs: options.minTotalLatencyMs,
    minToolResultCount: options.minToolResultCount,
  });

  const holdout = splitSessionsChronologically(longHorizonSessions, options.evalRatio);
  const evalSessionIds = new Set(
    holdout.evalSessions.map((session) => session.sessionId),
  );

  const evalEvents = [...sessionEnvelopes.values()]
    .filter((envelope) => evalSessionIds.has(envelope.sessionId))
    .flatMap((envelope) => envelope.events);

  const eventById = new Map<string, Record<string, unknown>>();
  for (const event of evalEvents) {
    const id = String(event.id ?? "");
    if (!id) {
      continue;
    }
    eventById.set(id, event);
  }

  const evalEpisodesRaw = extractTrajectoryOutcomeEpisodes(evalEvents) as Array<
    Record<string, unknown>
  >;

  const sampledEpisodes = stratifiedSample(
    evalEpisodesRaw,
    options.sampleSize,
    options.seed,
  );

  const rows = sampledEpisodes.map((episode, index) => {
    return toSampleRow(episode, eventById, index, options.maxOutputChars);
  });

  const payload = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    traceRoot,
    format: options.format,
    toolName: options.toolName,
    files: {
      traceFilesFound: traceFiles.length,
      traceEventFilesScanned,
      piSessionFilesScanned,
      skippedForFormat,
    },
    holdout: {
      minSessionDurationMs: options.minSessionDurationMs,
      minTotalLatencyMs: options.minTotalLatencyMs,
      minToolResultCount: options.minToolResultCount,
      evalRatio: holdout.evalRatio,
      totalSessionsParsed: sessionSummaries.length,
      totalLongHorizonSessions: longHorizonSessions.length,
      evalSessionCount: holdout.evalSessions.length,
      evalEpisodeCount: evalEpisodesRaw.length,
    },
    sample: {
      requested: options.sampleSize,
      actual: rows.length,
      seed: options.seed,
      predictedIssueKindCounts: sampleStats(rows),
    },
    items: rows,
  };

  const outPath = resolve(process.cwd(), options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Trajectory calibration sample generated");
  console.log(`- trace root: ${traceRoot}`);
  console.log(
    [
      "- files used:",
      `trace-events=${traceEventFilesScanned},`,
      `pi-sessions=${piSessionFilesScanned},`,
      `skipped=${skippedForFormat}`,
    ].join(" "),
  );
  console.log(
    [
      "- holdout:",
      `sessions=${holdout.evalSessions.length},`,
      `episodes=${evalEpisodesRaw.length},`,
      `sample=${rows.length}`,
    ].join(" "),
  );
  console.log(`- sample output: ${outPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
