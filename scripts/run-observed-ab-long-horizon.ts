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
  strictNoFamilyOverlap: boolean;
  strict: boolean;
  json: boolean;
  out: string;
  thresholds: {
    minPairCount?: number;
    minRelativeDeadEndReduction?: number;
    minRelativeWallTimeReduction?: number;
    minRelativeTokenCountReduction?: number;
    minRelativeTokenProxyReduction?: number;
    minRecoverySuccessRateOn?: number;
    maxRecoverySuccessRateDrop?: number;
  };
  pairing: {
    minOccurrencesPerFamily?: number;
    requireCrossSession?: boolean;
    maxWallTimeRatio?: number;
    maxTokenCountRatio?: number;
  };
  trust: {
    bootstrapSamples?: number;
    confidenceLevel?: number;
    seed?: number;
  };
};

type SessionEnvelope = {
  sessionId: string;
  events: Array<Record<string, unknown>>;
  traceFiles: Set<string>;
};

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
    strictNoFamilyOverlap: false,
    strict: false,
    json: false,
    out: ".happy-paths/observed-ab-long-horizon/report.json",
    thresholds: {},
    pairing: {},
    trust: {},
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
    if (token === "--out") {
      options.out = String(value);
      index += 1;
      continue;
    }
    if (token === "--strict-no-family-overlap") {
      options.strictNoFamilyOverlap = true;
      continue;
    }
    if (token === "--min-occurrences-per-family") {
      options.pairing.minOccurrencesPerFamily = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--allow-same-session") {
      options.pairing.requireCrossSession = false;
      continue;
    }
    if (token === "--max-wall-time-ratio") {
      options.pairing.maxWallTimeRatio = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-token-count-ratio") {
      options.pairing.maxTokenCountRatio = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-pair-count") {
      options.thresholds.minPairCount = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-dead-end-reduction") {
      options.thresholds.minRelativeDeadEndReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-wall-time-reduction") {
      options.thresholds.minRelativeWallTimeReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-token-count-reduction") {
      options.thresholds.minRelativeTokenCountReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-token-proxy-reduction") {
      options.thresholds.minRelativeTokenProxyReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-recovery-success-rate-on") {
      options.thresholds.minRecoverySuccessRateOn = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-recovery-success-rate-drop") {
      options.thresholds.maxRecoverySuccessRateDrop = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--bootstrap-samples") {
      options.trust.bootstrapSamples = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--confidence-level") {
      options.trust.confidenceLevel = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--seed") {
      options.trust.seed = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--strict") {
      options.strict = true;
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

function toExitCode(
  options: ParsedOptions,
  familyOverlapCount: number,
  gatePass: boolean,
): number {
  let exitCode = 0;

  if (options.strictNoFamilyOverlap && familyOverlapCount > 0) {
    exitCode = 3;
  }

  if (options.strict && !gatePass) {
    exitCode = exitCode === 0 ? 2 : exitCode;
  }

  return exitCode;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const distPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(distPath)) {
    throw new Error("dist/index.js not found. Run `npm run build` first.");
  }

  const {
    buildTraceEventsFromPiSessionRecords,
    evaluateObservedAbGate,
    extractObservedAbEpisodes,
    filterLongHorizonSessions,
    splitSessionsChronologically,
    summarizeFamilyOverlap,
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
  const trainSessionIds = new Set(
    holdout.trainSessions.map((session) => session.sessionId),
  );
  const evalSessionIds = new Set(
    holdout.evalSessions.map((session) => session.sessionId),
  );

  const trainEvents = [...sessionEnvelopes.values()]
    .filter((envelope) => trainSessionIds.has(envelope.sessionId))
    .flatMap((envelope) => envelope.events);
  const evalEvents = [...sessionEnvelopes.values()]
    .filter((envelope) => evalSessionIds.has(envelope.sessionId))
    .flatMap((envelope) => envelope.events);

  const trainEpisodes = extractObservedAbEpisodes(trainEvents);
  const evalEpisodes = extractObservedAbEpisodes(evalEvents);
  const familyOverlap = summarizeFamilyOverlap(trainEpisodes, evalEpisodes);

  const observedReport = evaluateObservedAbGate(
    evalEpisodes,
    options.thresholds,
    {
      minOccurrencesPerFamily: options.pairing.minOccurrencesPerFamily,
      requireCrossSession: options.pairing.requireCrossSession,
      maxWallTimeRatio: options.pairing.maxWallTimeRatio,
      maxTokenCountRatio: options.pairing.maxTokenCountRatio,
    },
    {
      bootstrapSamples: options.trust.bootstrapSamples,
      confidenceLevel: options.trust.confidenceLevel,
      seed: options.trust.seed,
    },
  );

  const report = {
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
      trainSessionCount: holdout.trainSessions.length,
      evalSessionCount: holdout.evalSessions.length,
      familyOverlap,
    },
    trainEpisodeCount: trainEpisodes.length,
    evalEpisodeCount: evalEpisodes.length,
    thresholds: observedReport.thresholds,
    pairing: observedReport.pairing,
    pairingDiagnostics: observedReport.pairingDiagnostics,
    aggregate: observedReport.aggregate,
    trustSummary: observedReport.trustSummary,
    gateResult: observedReport.gateResult,
  };

  const outPath = resolve(process.cwd(), options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Observed A/B long-horizon holdout benchmark");
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
        "- sessions:",
        `parsed=${sessionSummaries.length},`,
        `long_horizon=${longHorizonSessions.length},`,
        `train=${holdout.trainSessions.length},`,
        `eval=${holdout.evalSessions.length}`,
      ].join(" "),
    );
    console.log(
      [
        "- family overlap:",
        `${familyOverlap.overlappingFamilyCount} overlapping`,
        `(${(familyOverlap.overlapRateByEvalFamilies * 100).toFixed(1)}% of eval families)`,
      ].join(" "),
    );
    console.log(`- eval episodes: ${evalEpisodes.length}`);
    console.log(`- pairs: ${observedReport.aggregate.totalPairs}`);
    console.log(
      [
        "- measured totals (OFF -> ON):",
        `${(observedReport.aggregate.totalWallTimeOffMs / 1000).toFixed(2)}s ->`,
        `${(observedReport.aggregate.totalWallTimeOnMs / 1000).toFixed(2)}s,`,
        `${observedReport.aggregate.totalTokenCountOff.toFixed(0)} ->`,
        `${observedReport.aggregate.totalTokenCountOn.toFixed(0)} tokens`,
      ].join(" "),
    );
    console.log(
      [
        "- deltas:",
        `dead_end=${observedReport.aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3)},`,
        `wall=${observedReport.aggregate.relativeWallTimeReduction.toFixed(3)},`,
        `tokens=${observedReport.aggregate.relativeTokenCountReduction.toFixed(3)}`,
      ].join(" "),
    );
    console.log(`- gate pass: ${observedReport.gateResult.pass}`);
    if (!observedReport.gateResult.pass) {
      console.log("- gate failures:");
      for (const failure of observedReport.gateResult.failures) {
        console.log(`  - ${failure}`);
      }
    }
    console.log(`- report json: ${outPath}`);
  }

  const exitCode = toExitCode(
    options,
    familyOverlap.overlappingFamilyCount,
    observedReport.gateResult.pass,
  );
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
