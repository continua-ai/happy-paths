#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import type { SweBenchLiteTaskPack } from "../src/benchmarks/swebenchLite.js";
import {
  type SweBenchSessionIdentity,
  type SweBenchSessionPairingDiagnostics,
  type SweBenchSessionPairingResult,
  pairSweBenchSessions,
  parseSweBenchSessionId,
  relativeReduction,
} from "../src/benchmarks/swebenchTrajectory.js";
import { classifyTrajectoryIssue } from "../src/core/trajectoryOutcomeGate.js";
import type { TraceEvent } from "../src/core/types.js";

type ObservedReport = {
  generatedAtUtc: string;
  aggregate: {
    totalPairs: number;
    relativeRepeatedDeadEndRateReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
  };
  gateResult: {
    pass: boolean;
    failures: string[];
  };
};

type TrajectoryReport = {
  generatedAtUtc: string;
  primaryLane?: string;
  aggregate: {
    totalPairs: number;
    relativeHarmfulRetryReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
    judgeableCoverageOn: number;
  };
  gateResult: {
    pass: boolean;
    failures: string[];
  };
  laneReports?: {
    full_eval?: {
      aggregate: {
        totalPairs: number;
      };
    };
    family_disjoint_eval?: {
      aggregate: {
        totalPairs: number;
      };
    };
  };
};

type PiRunManifest = {
  runs: Array<{
    sessionId: string;
    variant?: "off" | "on";
    timedOut: boolean;
    durationMs?: number;
    stderrPath?: string;
    finalAnswerPath?: string;
    exitCode?: number;
  }>;
};

type RunTimeoutSummary = {
  offRunsTimedOut: number;
  onRunsTimedOut: number;
  offTimeoutRate: number;
  onTimeoutRate: number;
  timeoutRateDeltaOnMinusOff: number;
};

type RunWallTimeSummary = {
  source: "runs_manifest_durationMs" | "trace_turn_latency";
  sessionsUsingManifestDuration: number;
  sessionsUsingTraceLatencyFallback: number;
  sessionDurationMsById: Map<string, number>;
};

type RunContaminationSummary = {
  contaminatedSessionIds: Set<string>;
  contaminatedRunCount: number;
  contaminatedOffRunCount: number;
  contaminatedOnRunCount: number;
};

type TaskOutcomeSignalSummary = {
  offRunCount: number;
  onRunCount: number;
  offRunsWithReportedFinalStatus: number;
  onRunsWithReportedFinalStatus: number;
  offReportedSuccessRuns: number;
  onReportedSuccessRuns: number;
  offReportedSuccessRate: number;
  onReportedSuccessRate: number;
  reportedSuccessRateDeltaOnMinusOff: number;
  offExitZeroRuns: number;
  onExitZeroRuns: number;
  offExitZeroRate: number;
  onExitZeroRate: number;
  exitZeroRateDeltaOnMinusOff: number;
};

type SessionAggregate = {
  sessionId: string;
  eventCount: number;
  toolResultCount: number;
  checkpointCount: number;
  hintCount: number;
  failureWarningHintCount: number;
  totalFailures: number;
  harmfulFailures: number;
  wallTimeMs: number;
  llmTurnLatencyMs: number;
  tokenCount: number;
};

type TaskPairedTrajectorySummary = {
  sessionIdFormat: string;
  parsedSessionCount: number;
  unparsedSessionCount: number;
  diagnostics: SweBenchSessionPairingDiagnostics;
  pairedRunCountWithMetrics: number;
  totals: {
    failuresOff: number;
    failuresOn: number;
    harmfulOff: number;
    harmfulOn: number;
    wallTimeOffMs: number;
    wallTimeOnMs: number;
    tokenCountOff: number;
    tokenCountOn: number;
  };
  harmfulRetryRateOff: number;
  harmfulRetryRateOn: number;
  relativeHarmfulRetryReduction: number;
  relativeWallTimeReduction: number;
  relativeTokenCountReduction: number;
};

type TaskPairedValidityThresholds = {
  minQualifiedPairCount: number;
  minOnCheckpointCoverage: number;
  maxOnVsOffLikelyCensoredRateDelta: number;
  maxOnVsOffTimeoutRateDelta: number;
};

type TaskPairedRunQualitySummary = {
  offRunCount: number;
  onRunCount: number;
  offRunsLikelyCensored: number;
  onRunsLikelyCensored: number;
  offLikelyCensoredRate: number;
  onLikelyCensoredRate: number;
  likelyCensoredRateDeltaOnMinusOff: number;
  offRunsTimedOut: number | null;
  onRunsTimedOut: number | null;
  offTimeoutRate: number | null;
  onTimeoutRate: number | null;
  timeoutRateDeltaOnMinusOff: number | null;
  onRunsWithCheckpoint: number;
  onCheckpointCoverage: number;
  onRunsWithHints: number;
  onHintCoverage: number;
  onRunsWithFailureWarningHints: number;
  onFailureWarningHintCoverage: number;
  qualifiedPairCount: number;
  unqualifiedPairCount: number;
  qualifiedPairRate: number;
};

type TaskPairedValidityGateResult = {
  pass: boolean;
  failures: string[];
};

function parseIntArg(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parseFloatArg(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): {
  tasks: string;
  traceRoot: string;
  canonicalizeTraces: boolean;
  canonicalTraceRoot: string | null;
  format: "auto" | "trace" | "pi";
  toolName: string;
  minSessionDurationMs: number;
  minTotalLatencyMs: number;
  minToolResultCount: number;
  evalRatio: number;
  minFamilyDisjointPairCount: number;
  outDir: string;
  sessionIdPrefix: string;
  runsManifest: string | null;
  requireTaskPairs: boolean;
  strict: boolean;
  enableTaskPairedValidityGates: boolean;
  minQualifiedTaskPairedCount: number;
  minOnCheckpointCoverage: number;
  maxOnVsOffLikelyCensoredRateDelta: number;
  maxOnVsOffTimeoutRateDelta: number;
} {
  const options = {
    tasks: ".happy-paths/benchmarks/swebench_lite_50/tasks.json",
    traceRoot: ".happy-paths/benchmarks/swebench_lite_50/traces",
    canonicalizeTraces: true,
    canonicalTraceRoot: null as string | null,
    format: "trace" as const,
    toolName: "bash",
    minSessionDurationMs: 1_000,
    minTotalLatencyMs: 0,
    minToolResultCount: 2,
    evalRatio: 0.3,
    minFamilyDisjointPairCount: 20,
    outDir: ".happy-paths/benchmarks/swebench_lite_50/results",
    sessionIdPrefix: "swebench",
    runsManifest: null as string | null,
    requireTaskPairs: false,
    strict: false,
    enableTaskPairedValidityGates: true,
    minQualifiedTaskPairedCount: 3,
    minOnCheckpointCoverage: 0.8,
    maxOnVsOffLikelyCensoredRateDelta: 0.2,
    maxOnVsOffTimeoutRateDelta: 0.2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--tasks") {
      options.tasks = String(value);
      index += 1;
      continue;
    }
    if (token === "--trace-root") {
      options.traceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--canonical-trace-root") {
      options.canonicalTraceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--no-canonicalize-traces") {
      options.canonicalizeTraces = false;
      continue;
    }
    if (token === "--format") {
      const format = String(value);
      if (format !== "auto" && format !== "trace" && format !== "pi") {
        throw new Error(`invalid --format: ${format}`);
      }
      options.format = format;
      index += 1;
      continue;
    }
    if (token === "--tool-name") {
      options.toolName = String(value);
      index += 1;
      continue;
    }
    if (token === "--min-session-duration-ms") {
      options.minSessionDurationMs = Math.max(0, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--min-total-latency-ms") {
      options.minTotalLatencyMs = Math.max(0, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--min-tool-result-count") {
      options.minToolResultCount = Math.max(1, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--eval-ratio") {
      options.evalRatio = Math.max(
        0.05,
        Math.min(0.95, parseFloatArg(String(value), token)),
      );
      index += 1;
      continue;
    }
    if (token === "--min-family-disjoint-pair-count") {
      options.minFamilyDisjointPairCount = Math.max(
        0,
        parseIntArg(String(value), token),
      );
      index += 1;
      continue;
    }
    if (token === "--out-dir") {
      options.outDir = String(value);
      index += 1;
      continue;
    }
    if (token === "--session-id-prefix") {
      options.sessionIdPrefix = String(value);
      index += 1;
      continue;
    }
    if (token === "--runs-manifest") {
      options.runsManifest = String(value);
      index += 1;
      continue;
    }
    if (token === "--require-task-pairs") {
      options.requireTaskPairs = true;
      continue;
    }
    if (token === "--no-task-paired-validity-gates") {
      options.enableTaskPairedValidityGates = false;
      continue;
    }
    if (token === "--min-qualified-task-paired-count") {
      options.minQualifiedTaskPairedCount = Math.max(
        0,
        parseIntArg(String(value), token),
      );
      index += 1;
      continue;
    }
    if (token === "--min-on-checkpoint-coverage") {
      options.minOnCheckpointCoverage = Math.max(
        0,
        Math.min(1, parseFloatArg(String(value), token)),
      );
      index += 1;
      continue;
    }
    if (token === "--max-on-vs-off-likely-censored-rate-delta") {
      options.maxOnVsOffLikelyCensoredRateDelta = Math.max(
        0,
        Math.min(1, parseFloatArg(String(value), token)),
      );
      index += 1;
      continue;
    }
    if (token === "--max-on-vs-off-timeout-rate-delta") {
      options.maxOnVsOffTimeoutRateDelta = Math.max(
        0,
        Math.min(1, parseFloatArg(String(value), token)),
      );
      index += 1;
      continue;
    }
    if (token === "--strict") {
      options.strict = true;
    }
  }

  return options;
}

function runCommand(cwd: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `command failed (${result.status ?? "unknown"}): ${command} ${args.join(" ")}`,
    );
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function parseTaskPack(raw: string): SweBenchLiteTaskPack {
  const parsed = JSON.parse(raw) as Partial<SweBenchLiteTaskPack>;
  if (!Array.isArray(parsed.tasks)) {
    throw new Error("invalid task pack: missing tasks");
  }

  return {
    schemaVersion: 1,
    generatedAtUtc:
      typeof parsed.generatedAtUtc === "string"
        ? parsed.generatedAtUtc
        : new Date().toISOString(),
    source:
      parsed.source && typeof parsed.source === "object"
        ? {
            dataset:
              typeof parsed.source.dataset === "string"
                ? parsed.source.dataset
                : "unknown",
            config:
              typeof parsed.source.config === "string"
                ? parsed.source.config
                : "unknown",
            split:
              typeof parsed.source.split === "string" ? parsed.source.split : "unknown",
            offset: typeof parsed.source.offset === "number" ? parsed.source.offset : 0,
            count: typeof parsed.source.count === "number" ? parsed.source.count : 0,
            fetchedAtUtc:
              typeof parsed.source.fetchedAtUtc === "string"
                ? parsed.source.fetchedAtUtc
                : new Date().toISOString(),
            url: typeof parsed.source.url === "string" ? parsed.source.url : "",
          }
        : {
            dataset: "unknown",
            config: "unknown",
            split: "unknown",
            offset: 0,
            count: 0,
            fetchedAtUtc: new Date().toISOString(),
            url: "",
          },
    tasks: parsed.tasks,
  };
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
      const absolutePath = `${currentPath}/${entry.name}`;
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

function parseJsonlRecords(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  return records;
}

function isTraceEventRecord(record: Record<string, unknown>): record is TraceEvent {
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

async function loadSessions(traceRoot: string): Promise<{
  traceFilesFound: number;
  traceEventFiles: number;
  sessionsById: Map<string, TraceEvent[]>;
}> {
  const traceFiles = await collectJsonlFiles(traceRoot);
  const sessionsById = new Map<string, TraceEvent[]>();
  let traceEventFiles = 0;

  for (const filePath of traceFiles) {
    const records = parseJsonlRecords(await readFile(filePath, "utf-8"));
    const traceEvents = records.filter((record) => isTraceEventRecord(record));

    if (traceEvents.length === 0) {
      continue;
    }

    traceEventFiles += 1;

    for (const event of traceEvents) {
      const bucket = sessionsById.get(event.sessionId);
      if (bucket) {
        bucket.push(event);
        continue;
      }
      sessionsById.set(event.sessionId, [event]);
    }
  }

  for (const [sessionId, events] of sessionsById.entries()) {
    const sorted = [...events].sort((left, right) => {
      if (left.timestamp < right.timestamp) {
        return -1;
      }
      if (left.timestamp > right.timestamp) {
        return 1;
      }
      return left.id.localeCompare(right.id);
    });
    sessionsById.set(sessionId, sorted);
  }

  return {
    traceFilesFound: traceFiles.length,
    traceEventFiles,
    sessionsById,
  };
}

type CanonicalizeSweBenchTraceResult = {
  sourceTraceRoot: string;
  canonicalTraceRoot: string;
  filesScanned: number;
  swebenchEventsParsed: number;
  skippedNonSwebenchSessionEvents: number;
  duplicateEventsDiscarded: number;
  canonicalSessionCount: number;
};

async function canonicalizeSweBenchTraceRoot(options: {
  sourceTraceRoot: string;
  canonicalTraceRoot: string;
  sessionIdPrefix: string;
}): Promise<CanonicalizeSweBenchTraceResult> {
  const files = await collectJsonlFiles(options.sourceTraceRoot);
  const eventsBySessionId = new Map<string, Map<string, TraceEvent>>();

  let eventCount = 0;
  let skippedNonSwebenchSessionEvents = 0;
  let duplicateEventsDiscarded = 0;

  for (const filePath of files) {
    const records = parseJsonlRecords(await readFile(filePath, "utf-8"));
    for (const record of records) {
      if (!isTraceEventRecord(record)) {
        continue;
      }

      if (!parseSweBenchSessionId(record.sessionId, options.sessionIdPrefix)) {
        skippedNonSwebenchSessionEvents += 1;
        continue;
      }

      eventCount += 1;
      const bucket =
        eventsBySessionId.get(record.sessionId) ?? new Map<string, TraceEvent>();
      if (bucket.has(record.id)) {
        duplicateEventsDiscarded += 1;
        eventsBySessionId.set(record.sessionId, bucket);
        continue;
      }

      bucket.set(record.id, record);
      eventsBySessionId.set(record.sessionId, bucket);
    }
  }

  await rm(options.canonicalTraceRoot, { recursive: true, force: true });
  await mkdir(options.canonicalTraceRoot, { recursive: true });

  for (const [sessionId, eventsById] of eventsBySessionId.entries()) {
    const events = [...eventsById.values()].sort((left, right) => {
      if (left.timestamp < right.timestamp) {
        return -1;
      }
      if (left.timestamp > right.timestamp) {
        return 1;
      }
      return left.id.localeCompare(right.id);
    });

    const outPath = resolve(
      options.canonicalTraceRoot,
      "sessions",
      `${sessionId}.jsonl`,
    );
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(
      outPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf-8",
    );
  }

  return {
    sourceTraceRoot: options.sourceTraceRoot,
    canonicalTraceRoot: options.canonicalTraceRoot,
    filesScanned: files.length,
    swebenchEventsParsed: eventCount,
    skippedNonSwebenchSessionEvents,
    duplicateEventsDiscarded,
    canonicalSessionCount: eventsBySessionId.size,
  };
}

function eventTokenCount(event: TraceEvent): number {
  const tokens = event.metrics?.tokens;
  if (!tokens) {
    return 0;
  }

  return (
    (tokens.inputUncached ?? 0) +
    (tokens.inputCached ?? 0) +
    (tokens.output ?? 0) +
    (tokens.thinking ?? 0) +
    (tokens.cacheWrite ?? 0)
  );
}

function isFailure(event: TraceEvent): boolean {
  if (event.type !== "tool_result") {
    return false;
  }

  if (event.metrics?.outcome === "failure") {
    return true;
  }

  return event.payload?.isError === true;
}

function toFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

const RUN_CONTAMINATION_STDERR_PATTERNS: RegExp[] = [
  /chatgpt usage limit/i,
  /usage limit/i,
  /rate limit/i,
  /too many requests/i,
  /unauthorized/i,
  /authentication error/i,
  /invalid api key/i,
  /model preflight failed/i,
];

function parseRunVariant(
  run: PiRunManifest["runs"][number],
  sessionIdPrefix: string,
): "off" | "on" | null {
  if (run.variant === "off" || run.variant === "on") {
    return run.variant;
  }

  const identity = parseSweBenchSessionId(run.sessionId, sessionIdPrefix);
  return identity?.variant ?? null;
}

function buildRunWallTimeSummary(options: {
  runsManifest: PiRunManifest | null;
  sessionIdsInScope: Set<string>;
}): RunWallTimeSummary {
  const sessionDurationMsById = new Map<string, number>();

  if (options.runsManifest?.runs) {
    for (const run of options.runsManifest.runs) {
      if (!options.sessionIdsInScope.has(run.sessionId)) {
        continue;
      }

      const durationMs = toFiniteNumber(run.durationMs);
      if (durationMs <= 0) {
        continue;
      }

      sessionDurationMsById.set(run.sessionId, durationMs);
    }
  }

  const sessionsUsingManifestDuration = sessionDurationMsById.size;
  const sessionsUsingTraceLatencyFallback = Math.max(
    0,
    options.sessionIdsInScope.size - sessionsUsingManifestDuration,
  );

  return {
    source:
      sessionsUsingManifestDuration > 0
        ? "runs_manifest_durationMs"
        : "trace_turn_latency",
    sessionsUsingManifestDuration,
    sessionsUsingTraceLatencyFallback,
    sessionDurationMsById,
  };
}

function isContaminatedRunStderr(stderrText: string): boolean {
  return RUN_CONTAMINATION_STDERR_PATTERNS.some((pattern) => {
    return pattern.test(stderrText);
  });
}

async function buildRunContaminationSummary(options: {
  runsManifest: PiRunManifest | null;
  sessionIdPrefix: string;
  sessionIdsInScope: Set<string>;
}): Promise<RunContaminationSummary> {
  const contaminatedSessionIds = new Set<string>();
  let contaminatedRunCount = 0;
  let contaminatedOffRunCount = 0;
  let contaminatedOnRunCount = 0;

  if (!options.runsManifest?.runs) {
    return {
      contaminatedSessionIds,
      contaminatedRunCount,
      contaminatedOffRunCount,
      contaminatedOnRunCount,
    };
  }

  for (const run of options.runsManifest.runs) {
    if (!options.sessionIdsInScope.has(run.sessionId)) {
      continue;
    }

    if (!run.stderrPath) {
      continue;
    }

    let stderrText = "";
    try {
      stderrText = await readFile(run.stderrPath, "utf-8");
    } catch {
      continue;
    }

    if (!isContaminatedRunStderr(stderrText)) {
      continue;
    }

    contaminatedRunCount += 1;
    contaminatedSessionIds.add(run.sessionId);

    const variant = parseRunVariant(run, options.sessionIdPrefix);
    if (variant === "off") {
      contaminatedOffRunCount += 1;
    }
    if (variant === "on") {
      contaminatedOnRunCount += 1;
    }
  }

  return {
    contaminatedSessionIds,
    contaminatedRunCount,
    contaminatedOffRunCount,
    contaminatedOnRunCount,
  };
}

function parseReportedFinalStatus(
  text: string,
): "success" | "partial" | "blocked" | null {
  const match = /FINAL_STATUS:\s*(success|partial|blocked)/i.exec(text);
  if (!match?.[1]) {
    return null;
  }

  const normalized = match[1].toLowerCase();
  if (
    normalized === "success" ||
    normalized === "partial" ||
    normalized === "blocked"
  ) {
    return normalized;
  }

  return null;
}

async function buildTaskOutcomeSignalSummary(options: {
  runsManifest: PiRunManifest | null;
  sessionIdPrefix: string;
  sessionIdsInScope: Set<string>;
}): Promise<TaskOutcomeSignalSummary | null> {
  if (!options.runsManifest?.runs) {
    return null;
  }

  let offRunCount = 0;
  let onRunCount = 0;
  let offRunsWithReportedFinalStatus = 0;
  let onRunsWithReportedFinalStatus = 0;
  let offReportedSuccessRuns = 0;
  let onReportedSuccessRuns = 0;
  let offExitZeroRuns = 0;
  let onExitZeroRuns = 0;

  for (const run of options.runsManifest.runs) {
    if (!options.sessionIdsInScope.has(run.sessionId)) {
      continue;
    }

    const variant = parseRunVariant(run, options.sessionIdPrefix);
    if (!variant) {
      continue;
    }

    if (variant === "off") {
      offRunCount += 1;
      if (run.exitCode === 0) {
        offExitZeroRuns += 1;
      }
    } else {
      onRunCount += 1;
      if (run.exitCode === 0) {
        onExitZeroRuns += 1;
      }
    }

    if (!run.finalAnswerPath) {
      continue;
    }

    let finalAnswer = "";
    try {
      finalAnswer = await readFile(run.finalAnswerPath, "utf-8");
    } catch {
      continue;
    }

    const status = parseReportedFinalStatus(finalAnswer);
    if (!status) {
      continue;
    }

    if (variant === "off") {
      offRunsWithReportedFinalStatus += 1;
      if (status === "success") {
        offReportedSuccessRuns += 1;
      }
      continue;
    }

    onRunsWithReportedFinalStatus += 1;
    if (status === "success") {
      onReportedSuccessRuns += 1;
    }
  }

  if (offRunCount + onRunCount < 1) {
    return null;
  }

  const offReportedSuccessRate = rate(offReportedSuccessRuns, offRunCount);
  const onReportedSuccessRate = rate(onReportedSuccessRuns, onRunCount);
  const offExitZeroRate = rate(offExitZeroRuns, offRunCount);
  const onExitZeroRate = rate(onExitZeroRuns, onRunCount);

  return {
    offRunCount,
    onRunCount,
    offRunsWithReportedFinalStatus,
    onRunsWithReportedFinalStatus,
    offReportedSuccessRuns,
    onReportedSuccessRuns,
    offReportedSuccessRate,
    onReportedSuccessRate,
    reportedSuccessRateDeltaOnMinusOff: onReportedSuccessRate - offReportedSuccessRate,
    offExitZeroRuns,
    onExitZeroRuns,
    offExitZeroRate,
    onExitZeroRate,
    exitZeroRateDeltaOnMinusOff: onExitZeroRate - offExitZeroRate,
  };
}

function isHappyPathsHintCheckpoint(event: TraceEvent): boolean {
  if (event.type !== "checkpoint") {
    return false;
  }

  return event.payload?.kind === "happy_paths_prior_hints";
}

function summarizeSessions(options: {
  sessionsById: Map<string, TraceEvent[]>;
  runWallTimeSummary: RunWallTimeSummary;
}): Map<string, SessionAggregate> {
  const output = new Map<string, SessionAggregate>();

  for (const [sessionId, events] of options.sessionsById.entries()) {
    let totalFailures = 0;
    let harmfulFailures = 0;
    let llmTurnLatencyMs = 0;
    let tokenCount = 0;
    let toolResultCount = 0;
    let checkpointCount = 0;
    let hintCount = 0;
    let failureWarningHintCount = 0;

    for (const event of events) {
      llmTurnLatencyMs += event.metrics?.latencyMs ?? 0;
      tokenCount += eventTokenCount(event);

      if (event.type === "tool_result") {
        toolResultCount += 1;
      }

      if (isHappyPathsHintCheckpoint(event)) {
        checkpointCount += 1;
        hintCount += toFiniteNumber(event.payload.hintCount);
        failureWarningHintCount += toFiniteNumber(
          event.payload.failureWarningHintCount,
        );
      }

      if (!isFailure(event)) {
        continue;
      }

      totalFailures += 1;
      const issue = classifyTrajectoryIssue(event);
      if (issue?.harmful) {
        harmfulFailures += 1;
      }
    }

    const wallTimeMs =
      options.runWallTimeSummary.sessionDurationMsById.get(sessionId) ??
      llmTurnLatencyMs;

    output.set(sessionId, {
      sessionId,
      eventCount: events.length,
      toolResultCount,
      checkpointCount,
      hintCount,
      failureWarningHintCount,
      totalFailures,
      harmfulFailures,
      wallTimeMs,
      llmTurnLatencyMs,
      tokenCount,
    });
  }

  return output;
}

type SweBenchPairingFromAggregates = {
  parsedIdentities: SweBenchSessionIdentity[];
  pairing: SweBenchSessionPairingResult;
};

function buildSweBenchPairingFromAggregates(options: {
  sessionAggregates: Map<string, SessionAggregate>;
  sessionIdPrefix: string;
}): SweBenchPairingFromAggregates {
  const parsedIdentities = [...options.sessionAggregates.keys()]
    .map((sessionId) => parseSweBenchSessionId(sessionId, options.sessionIdPrefix))
    .filter((identity): identity is SweBenchSessionIdentity => identity !== null);

  return {
    parsedIdentities,
    pairing: pairSweBenchSessions(parsedIdentities),
  };
}

function isLikelyCensoredSession(
  session: SessionAggregate,
  minToolResultCount: number,
): boolean {
  if (session.eventCount <= 1) {
    return true;
  }

  if (session.checkpointCount < 1) {
    return true;
  }

  if (session.toolResultCount < minToolResultCount) {
    return true;
  }

  return false;
}

function buildRunTimeoutSummary(options: {
  runsManifest: PiRunManifest | null;
  sessionIdPrefix: string;
  sessionIdsInScope: Set<string>;
}): RunTimeoutSummary | null {
  if (!options.runsManifest || !Array.isArray(options.runsManifest.runs)) {
    return null;
  }

  let offRunCount = 0;
  let onRunCount = 0;
  let offRunsTimedOut = 0;
  let onRunsTimedOut = 0;

  for (const run of options.runsManifest.runs) {
    if (!options.sessionIdsInScope.has(run.sessionId)) {
      continue;
    }

    const variant = parseRunVariant(run, options.sessionIdPrefix);

    if (!variant) {
      continue;
    }

    if (variant === "off") {
      offRunCount += 1;
      if (run.timedOut) {
        offRunsTimedOut += 1;
      }
      continue;
    }

    onRunCount += 1;
    if (run.timedOut) {
      onRunsTimedOut += 1;
    }
  }

  if (offRunCount + onRunCount < 1) {
    return null;
  }

  const offTimeoutRate = rate(offRunsTimedOut, offRunCount);
  const onTimeoutRate = rate(onRunsTimedOut, onRunCount);

  return {
    offRunsTimedOut,
    onRunsTimedOut,
    offTimeoutRate,
    onTimeoutRate,
    timeoutRateDeltaOnMinusOff: onTimeoutRate - offTimeoutRate,
  };
}

function buildTaskPairedTrajectorySummary(options: {
  sessionAggregates: Map<string, SessionAggregate>;
  sessionIdPrefix: string;
  pairingFromAggregates: SweBenchPairingFromAggregates;
  includePair?: (off: SessionAggregate, on: SessionAggregate) => boolean;
}): TaskPairedTrajectorySummary {
  const { parsedIdentities, pairing } = options.pairingFromAggregates;

  let failuresOff = 0;
  let failuresOn = 0;
  let harmfulOff = 0;
  let harmfulOn = 0;
  let wallTimeOffMs = 0;
  let wallTimeOnMs = 0;
  let tokenCountOff = 0;
  let tokenCountOn = 0;
  let pairedRunCountWithMetrics = 0;

  for (const pair of pairing.pairs) {
    const off = options.sessionAggregates.get(pair.offSessionId);
    const on = options.sessionAggregates.get(pair.onSessionId);

    if (!off || !on) {
      continue;
    }

    if (options.includePair && !options.includePair(off, on)) {
      continue;
    }

    pairedRunCountWithMetrics += 1;
    failuresOff += off.totalFailures;
    failuresOn += on.totalFailures;
    harmfulOff += off.harmfulFailures;
    harmfulOn += on.harmfulFailures;
    wallTimeOffMs += off.wallTimeMs;
    wallTimeOnMs += on.wallTimeMs;
    tokenCountOff += off.tokenCount;
    tokenCountOn += on.tokenCount;
  }

  const harmfulRetryRateOff = rate(harmfulOff, failuresOff);
  const harmfulRetryRateOn = rate(harmfulOn, failuresOn);

  return {
    sessionIdFormat: `${options.sessionIdPrefix}::<instance_id>::<off|on>::<replicate>`,
    parsedSessionCount: parsedIdentities.length,
    unparsedSessionCount: Math.max(
      0,
      options.sessionAggregates.size - parsedIdentities.length,
    ),
    diagnostics: pairing.diagnostics,
    pairedRunCountWithMetrics,
    totals: {
      failuresOff,
      failuresOn,
      harmfulOff,
      harmfulOn,
      wallTimeOffMs,
      wallTimeOnMs,
      tokenCountOff,
      tokenCountOn,
    },
    harmfulRetryRateOff,
    harmfulRetryRateOn,
    relativeHarmfulRetryReduction: relativeReduction(
      harmfulRetryRateOff,
      harmfulRetryRateOn,
    ),
    relativeWallTimeReduction: relativeReduction(wallTimeOffMs, wallTimeOnMs),
    relativeTokenCountReduction: relativeReduction(tokenCountOff, tokenCountOn),
  };
}

function buildTaskPairedRunQualitySummary(options: {
  sessionAggregates: Map<string, SessionAggregate>;
  sessionIdPrefix: string;
  pairingFromAggregates: SweBenchPairingFromAggregates;
  minToolResultCount: number;
  runTimeoutSummary: RunTimeoutSummary | null;
}): TaskPairedRunQualitySummary {
  const offSessions: SessionAggregate[] = [];
  const onSessions: SessionAggregate[] = [];

  for (const [sessionId, aggregate] of options.sessionAggregates.entries()) {
    const identity = parseSweBenchSessionId(sessionId, options.sessionIdPrefix);
    if (!identity) {
      continue;
    }

    if (identity.variant === "off") {
      offSessions.push(aggregate);
    } else {
      onSessions.push(aggregate);
    }
  }

  const offRunsLikelyCensored = offSessions.filter((session) => {
    return isLikelyCensoredSession(session, options.minToolResultCount);
  }).length;
  const onRunsLikelyCensored = onSessions.filter((session) => {
    return isLikelyCensoredSession(session, options.minToolResultCount);
  }).length;

  const onRunsWithCheckpoint = onSessions.filter((session) => {
    return session.checkpointCount > 0;
  }).length;
  const onRunsWithHints = onSessions.filter((session) => {
    return session.hintCount > 0;
  }).length;
  const onRunsWithFailureWarningHints = onSessions.filter((session) => {
    return session.failureWarningHintCount > 0;
  }).length;

  let qualifiedPairCount = 0;
  for (const pair of options.pairingFromAggregates.pairing.pairs) {
    const off = options.sessionAggregates.get(pair.offSessionId);
    const on = options.sessionAggregates.get(pair.onSessionId);
    if (!off || !on) {
      continue;
    }

    if (
      !isLikelyCensoredSession(off, options.minToolResultCount) &&
      !isLikelyCensoredSession(on, options.minToolResultCount)
    ) {
      qualifiedPairCount += 1;
    }
  }

  const pairCount = options.pairingFromAggregates.pairing.pairs.length;
  const offRunCount = offSessions.length;
  const onRunCount = onSessions.length;
  const offLikelyCensoredRate = rate(offRunsLikelyCensored, offRunCount);
  const onLikelyCensoredRate = rate(onRunsLikelyCensored, onRunCount);

  return {
    offRunCount,
    onRunCount,
    offRunsLikelyCensored,
    onRunsLikelyCensored,
    offLikelyCensoredRate,
    onLikelyCensoredRate,
    likelyCensoredRateDeltaOnMinusOff: onLikelyCensoredRate - offLikelyCensoredRate,
    offRunsTimedOut: options.runTimeoutSummary?.offRunsTimedOut ?? null,
    onRunsTimedOut: options.runTimeoutSummary?.onRunsTimedOut ?? null,
    offTimeoutRate: options.runTimeoutSummary?.offTimeoutRate ?? null,
    onTimeoutRate: options.runTimeoutSummary?.onTimeoutRate ?? null,
    timeoutRateDeltaOnMinusOff:
      options.runTimeoutSummary?.timeoutRateDeltaOnMinusOff ?? null,
    onRunsWithCheckpoint,
    onCheckpointCoverage: rate(onRunsWithCheckpoint, onRunCount),
    onRunsWithHints,
    onHintCoverage: rate(onRunsWithHints, onRunCount),
    onRunsWithFailureWarningHints,
    onFailureWarningHintCoverage: rate(onRunsWithFailureWarningHints, onRunCount),
    qualifiedPairCount,
    unqualifiedPairCount: Math.max(0, pairCount - qualifiedPairCount),
    qualifiedPairRate: rate(qualifiedPairCount, pairCount),
  };
}

function evaluateTaskPairedValidityGate(options: {
  summary: TaskPairedRunQualitySummary;
  thresholds: TaskPairedValidityThresholds;
}): TaskPairedValidityGateResult {
  const failures: string[] = [];

  if (options.summary.qualifiedPairCount < options.thresholds.minQualifiedPairCount) {
    failures.push(
      `qualified task-paired count ${options.summary.qualifiedPairCount} < ${options.thresholds.minQualifiedPairCount}`,
    );
  }

  if (
    options.summary.onCheckpointCoverage < options.thresholds.minOnCheckpointCoverage
  ) {
    failures.push(
      `on checkpoint coverage ${options.summary.onCheckpointCoverage.toFixed(3)} < ${options.thresholds.minOnCheckpointCoverage.toFixed(3)}`,
    );
  }

  if (
    options.summary.likelyCensoredRateDeltaOnMinusOff >
    options.thresholds.maxOnVsOffLikelyCensoredRateDelta
  ) {
    failures.push(
      `on-off likely-censored rate delta ${options.summary.likelyCensoredRateDeltaOnMinusOff.toFixed(3)} > ${options.thresholds.maxOnVsOffLikelyCensoredRateDelta.toFixed(3)}`,
    );
  }

  if (
    options.summary.timeoutRateDeltaOnMinusOff !== null &&
    options.summary.timeoutRateDeltaOnMinusOff >
      options.thresholds.maxOnVsOffTimeoutRateDelta
  ) {
    failures.push(
      `on-off timeout rate delta ${options.summary.timeoutRateDeltaOnMinusOff.toFixed(3)} > ${options.thresholds.maxOnVsOffTimeoutRateDelta.toFixed(3)}`,
    );
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const outDir = resolve(repoRoot, options.outDir);
  const observedOut = resolve(outDir, "observed_ab_report.json");
  const trajectoryOut = resolve(outDir, "trajectory_outcome_report.json");
  const summaryOut = resolve(outDir, "summary.json");

  const taskPackPath = resolve(repoRoot, options.tasks);
  const traceRootPath = resolve(repoRoot, options.traceRoot);
  const runsManifestPath = options.runsManifest
    ? resolve(repoRoot, options.runsManifest)
    : null;

  await mkdir(outDir, { recursive: true });

  const taskPack = parseTaskPack(await readFile(taskPackPath, "utf-8"));

  const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");

  let scoringTraceRootPath = traceRootPath;
  let canonicalization: CanonicalizeSweBenchTraceResult | null = null;

  if (options.canonicalizeTraces) {
    scoringTraceRootPath = resolve(
      repoRoot,
      options.canonicalTraceRoot ?? `${options.traceRoot}_clean`,
    );

    canonicalization = await canonicalizeSweBenchTraceRoot({
      sourceTraceRoot: traceRootPath,
      canonicalTraceRoot: scoringTraceRootPath,
      sessionIdPrefix: options.sessionIdPrefix,
    });
  }

  const observedArgs = [
    "scripts/run-observed-ab-long-horizon.ts",
    "--trace-root",
    scoringTraceRootPath,
    "--format",
    options.format,
    "--tool-name",
    options.toolName,
    "--min-session-duration-ms",
    String(options.minSessionDurationMs),
    "--min-total-latency-ms",
    String(options.minTotalLatencyMs),
    "--min-tool-result-count",
    String(options.minToolResultCount),
    "--eval-ratio",
    String(options.evalRatio),
    "--out",
    observedOut,
  ];

  if (options.strict) {
    observedArgs.push("--strict");
  }

  runCommand(repoRoot, tsxBin, observedArgs);

  const trajectoryArgs = [
    "scripts/run-trajectory-outcome-long-horizon.ts",
    "--trace-root",
    scoringTraceRootPath,
    "--format",
    options.format,
    "--tool-name",
    options.toolName,
    "--min-session-duration-ms",
    String(options.minSessionDurationMs),
    "--min-total-latency-ms",
    String(options.minTotalLatencyMs),
    "--min-tool-result-count",
    String(options.minToolResultCount),
    "--eval-ratio",
    String(options.evalRatio),
    "--min-family-disjoint-pair-count",
    String(options.minFamilyDisjointPairCount),
    "--out",
    trajectoryOut,
  ];

  if (options.strict) {
    trajectoryArgs.push("--strict");
  }

  runCommand(repoRoot, tsxBin, trajectoryArgs);

  const observedReport = await readJsonFile<ObservedReport>(observedOut);
  const trajectoryReport = await readJsonFile<TrajectoryReport>(trajectoryOut);
  const runsManifest = runsManifestPath
    ? await readJsonFile<PiRunManifest>(runsManifestPath)
    : null;

  const sessionData = await loadSessions(scoringTraceRootPath);
  const sessionIdsInScope = new Set(sessionData.sessionsById.keys());
  const runWallTimeSummary = buildRunWallTimeSummary({
    runsManifest,
    sessionIdsInScope,
  });

  const allSessionAggregates = summarizeSessions({
    sessionsById: sessionData.sessionsById,
    runWallTimeSummary,
  });

  const runContaminationSummary = await buildRunContaminationSummary({
    runsManifest,
    sessionIdPrefix: options.sessionIdPrefix,
    sessionIdsInScope,
  });

  const sessionAggregates = new Map(
    [...allSessionAggregates.entries()].filter(([sessionId]) => {
      return !runContaminationSummary.contaminatedSessionIds.has(sessionId);
    }),
  );

  const pairingFromAggregates = buildSweBenchPairingFromAggregates({
    sessionAggregates,
    sessionIdPrefix: options.sessionIdPrefix,
  });

  const scoredSessionIds = new Set(sessionAggregates.keys());

  const runTimeoutSummary = buildRunTimeoutSummary({
    runsManifest,
    sessionIdPrefix: options.sessionIdPrefix,
    sessionIdsInScope: scoredSessionIds,
  });

  const taskOutcomeSignalSummary = await buildTaskOutcomeSignalSummary({
    runsManifest,
    sessionIdPrefix: options.sessionIdPrefix,
    sessionIdsInScope: scoredSessionIds,
  });

  const taskPairedTrajectory = buildTaskPairedTrajectorySummary({
    sessionAggregates,
    sessionIdPrefix: options.sessionIdPrefix,
    pairingFromAggregates,
  });

  const taskPairedRunQualitySummary = buildTaskPairedRunQualitySummary({
    sessionAggregates,
    sessionIdPrefix: options.sessionIdPrefix,
    pairingFromAggregates,
    minToolResultCount: options.minToolResultCount,
    runTimeoutSummary,
  });

  const taskPairedValidityThresholds: TaskPairedValidityThresholds = {
    minQualifiedPairCount: options.minQualifiedTaskPairedCount,
    minOnCheckpointCoverage: options.minOnCheckpointCoverage,
    maxOnVsOffLikelyCensoredRateDelta: options.maxOnVsOffLikelyCensoredRateDelta,
    maxOnVsOffTimeoutRateDelta: options.maxOnVsOffTimeoutRateDelta,
  };

  const taskPairedValidityGateResult = options.enableTaskPairedValidityGates
    ? evaluateTaskPairedValidityGate({
        summary: taskPairedRunQualitySummary,
        thresholds: taskPairedValidityThresholds,
      })
    : {
        pass: true,
        failures: [] as string[],
      };

  const taskPairedTrajectoryQualified = buildTaskPairedTrajectorySummary({
    sessionAggregates,
    sessionIdPrefix: options.sessionIdPrefix,
    pairingFromAggregates,
    includePair: (off, on) => {
      return (
        !isLikelyCensoredSession(off, options.minToolResultCount) &&
        !isLikelyCensoredSession(on, options.minToolResultCount)
      );
    },
  });

  if (options.requireTaskPairs && taskPairedTrajectory.pairedRunCountWithMetrics < 1) {
    throw new Error(
      `no task-paired swebench trajectories found; use session IDs like '${taskPairedTrajectory.sessionIdFormat}'`,
    );
  }

  if (options.strict && runContaminationSummary.contaminatedRunCount > 0) {
    throw new Error(
      `run contamination detected (${runContaminationSummary.contaminatedRunCount} run(s)); rerun contaminated sessions before strict scoring`,
    );
  }

  if (
    options.strict &&
    options.enableTaskPairedValidityGates &&
    !taskPairedValidityGateResult.pass
  ) {
    throw new Error(
      `task-paired validity gate failed: ${taskPairedValidityGateResult.failures.join("; ")}`,
    );
  }

  const observedPairCount = observedReport.aggregate.totalPairs;
  const trajectoryPairCount = trajectoryReport.aggregate.totalPairs;

  const summary = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    taskPack: {
      path: taskPackPath,
      generatedAtUtc: taskPack.generatedAtUtc,
      taskCount: taskPack.tasks.length,
      source: taskPack.source,
    },
    traceRoot: scoringTraceRootPath,
    traceRootRaw: traceRootPath,
    runsManifestPath,
    traceCanonicalization: canonicalization,
    traceScan: {
      traceFilesFound: sessionData.traceFilesFound,
      traceEventFiles: sessionData.traceEventFiles,
      sessionsFound: sessionData.sessionsById.size,
    },
    commands: {
      observed: `${tsxBin} ${observedArgs.join(" ")}`,
      trajectory: `${tsxBin} ${trajectoryArgs.join(" ")}`,
    },
    evaluationPolicy: {
      primaryLane: "task_paired_trajectory",
      secondaryLanes: ["observed_ab_long_horizon", "trajectory_outcome_long_horizon"],
      rationale:
        "Task-paired OFF/ON trajectories preserve path dependence even when long-horizon holdout pairing is sparse.",
    },
    qualityFlags: {
      taskPairedRunCountWithMetrics: taskPairedTrajectory.pairedRunCountWithMetrics,
      taskPairedQualifiedRunCount:
        taskPairedTrajectoryQualified.pairedRunCountWithMetrics,
      taskPairedValidityGatesEnabled: options.enableTaskPairedValidityGates,
      taskPairedValidityGatePass: taskPairedValidityGateResult.pass,
      hasRunTimeoutSummary: runTimeoutSummary !== null,
      wallTimeSource: runWallTimeSummary.source,
      sessionsUsingManifestDuration: runWallTimeSummary.sessionsUsingManifestDuration,
      sessionsUsingTraceLatencyFallback:
        runWallTimeSummary.sessionsUsingTraceLatencyFallback,
      contaminatedRunCount: runContaminationSummary.contaminatedRunCount,
      contaminatedSessionCount: runContaminationSummary.contaminatedSessionIds.size,
      hasTaskOutcomeSignal: taskOutcomeSignalSummary !== null,
      observedLongHorizonPairCount: observedPairCount,
      trajectoryLongHorizonPairCount: trajectoryPairCount,
      longHorizonPairabilitySparse: observedPairCount < 3 || trajectoryPairCount < 3,
    },
    contamination: {
      contaminatedRunCount: runContaminationSummary.contaminatedRunCount,
      contaminatedOffRunCount: runContaminationSummary.contaminatedOffRunCount,
      contaminatedOnRunCount: runContaminationSummary.contaminatedOnRunCount,
      contaminatedSessionIds: [
        ...runContaminationSummary.contaminatedSessionIds,
      ].sort(),
    },
    taskOutcomeSignal: taskOutcomeSignalSummary,
    observed: {
      generatedAtUtc: observedReport.generatedAtUtc,
      pairCount: observedReport.aggregate.totalPairs,
      gatePass: observedReport.gateResult.pass,
      deadEndReduction: observedReport.aggregate.relativeRepeatedDeadEndRateReduction,
      wallTimeReduction: observedReport.aggregate.relativeWallTimeReduction,
      tokenCountReduction: observedReport.aggregate.relativeTokenCountReduction,
      failures: observedReport.gateResult.failures,
    },
    trajectory: {
      generatedAtUtc: trajectoryReport.generatedAtUtc,
      primaryLane: trajectoryReport.primaryLane ?? "family_disjoint_eval",
      pairCount: trajectoryReport.aggregate.totalPairs,
      fullEvalPairCount:
        trajectoryReport.laneReports?.full_eval?.aggregate.totalPairs ?? null,
      familyDisjointPairCount:
        trajectoryReport.laneReports?.family_disjoint_eval?.aggregate.totalPairs ??
        null,
      gatePass: trajectoryReport.gateResult.pass,
      harmfulRetryReduction: trajectoryReport.aggregate.relativeHarmfulRetryReduction,
      wallTimeReduction: trajectoryReport.aggregate.relativeWallTimeReduction,
      tokenCountReduction: trajectoryReport.aggregate.relativeTokenCountReduction,
      judgeableCoverageOn: trajectoryReport.aggregate.judgeableCoverageOn,
      failures: trajectoryReport.gateResult.failures,
    },
    taskPairedValidity: {
      thresholds: taskPairedValidityThresholds,
      summary: taskPairedRunQualitySummary,
      gateResult: taskPairedValidityGateResult,
    },
    taskPairedTrajectory,
    taskPairedTrajectoryQualified,
  };

  await mkdir(dirname(summaryOut), { recursive: true });
  await writeFile(summaryOut, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");

  if (observedPairCount < 3 || trajectoryPairCount < 3) {
    console.log(
      "NOTE: long-horizon pair counts are sparse; treat taskPairedTrajectory as the primary causal lane for this run.",
    );
  }

  if (options.enableTaskPairedValidityGates && !taskPairedValidityGateResult.pass) {
    console.log(
      `NOTE: task-paired validity gate failed (${taskPairedValidityGateResult.failures.join("; ")}). Prefer taskPairedTrajectoryQualified for quality-sensitive interpretation.`,
    );
  }

  if (runContaminationSummary.contaminatedRunCount > 0) {
    console.log(
      `NOTE: excluded ${runContaminationSummary.contaminatedRunCount} contaminated run(s) from task-paired scoring.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        outDir,
        summary: summaryOut,
        observedOut,
        trajectoryOut,
        evaluationPolicy: {
          primaryLane: "task_paired_trajectory",
          longHorizonPairabilitySparse:
            observedPairCount < 3 || trajectoryPairCount < 3,
          observedLongHorizonPairCount: observedPairCount,
          trajectoryLongHorizonPairCount: trajectoryPairCount,
        },
        measurement: {
          wallTimeSource: runWallTimeSummary.source,
          sessionsUsingManifestDuration:
            runWallTimeSummary.sessionsUsingManifestDuration,
          sessionsUsingTraceLatencyFallback:
            runWallTimeSummary.sessionsUsingTraceLatencyFallback,
        },
        contamination: {
          contaminatedRunCount: runContaminationSummary.contaminatedRunCount,
          contaminatedOffRunCount: runContaminationSummary.contaminatedOffRunCount,
          contaminatedOnRunCount: runContaminationSummary.contaminatedOnRunCount,
          contaminatedSessionCount: runContaminationSummary.contaminatedSessionIds.size,
        },
        taskOutcomeSignal: taskOutcomeSignalSummary
          ? {
              offReportedSuccessRate: taskOutcomeSignalSummary.offReportedSuccessRate,
              onReportedSuccessRate: taskOutcomeSignalSummary.onReportedSuccessRate,
              reportedSuccessRateDeltaOnMinusOff:
                taskOutcomeSignalSummary.reportedSuccessRateDeltaOnMinusOff,
              offExitZeroRate: taskOutcomeSignalSummary.offExitZeroRate,
              onExitZeroRate: taskOutcomeSignalSummary.onExitZeroRate,
              exitZeroRateDeltaOnMinusOff:
                taskOutcomeSignalSummary.exitZeroRateDeltaOnMinusOff,
            }
          : null,
        taskPairedValidity: {
          enabled: options.enableTaskPairedValidityGates,
          pass: taskPairedValidityGateResult.pass,
          failures: taskPairedValidityGateResult.failures,
          summary: {
            onCheckpointCoverage: taskPairedRunQualitySummary.onCheckpointCoverage,
            likelyCensoredRateDeltaOnMinusOff:
              taskPairedRunQualitySummary.likelyCensoredRateDeltaOnMinusOff,
            timeoutRateDeltaOnMinusOff:
              taskPairedRunQualitySummary.timeoutRateDeltaOnMinusOff,
            onTimeoutRate: taskPairedRunQualitySummary.onTimeoutRate,
            offTimeoutRate: taskPairedRunQualitySummary.offTimeoutRate,
            qualifiedPairCount: taskPairedRunQualitySummary.qualifiedPairCount,
          },
        },
        taskPairedTrajectory: {
          parsedSessionCount: taskPairedTrajectory.parsedSessionCount,
          pairedRunCountWithMetrics: taskPairedTrajectory.pairedRunCountWithMetrics,
          relativeHarmfulRetryReduction:
            taskPairedTrajectory.relativeHarmfulRetryReduction,
          relativeWallTimeReduction: taskPairedTrajectory.relativeWallTimeReduction,
          relativeTokenCountReduction: taskPairedTrajectory.relativeTokenCountReduction,
        },
        taskPairedTrajectoryQualified: {
          pairedRunCountWithMetrics:
            taskPairedTrajectoryQualified.pairedRunCountWithMetrics,
          relativeHarmfulRetryReduction:
            taskPairedTrajectoryQualified.relativeHarmfulRetryReduction,
          relativeWallTimeReduction:
            taskPairedTrajectoryQualified.relativeWallTimeReduction,
          relativeTokenCountReduction:
            taskPairedTrajectoryQualified.relativeTokenCountReduction,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
