#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import type { SweBenchLiteTaskPack } from "../src/benchmarks/swebenchLite.js";
import {
  type SweBenchSessionPairingDiagnostics,
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

type SessionAggregate = {
  sessionId: string;
  eventCount: number;
  totalFailures: number;
  harmfulFailures: number;
  wallTimeMs: number;
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
  format: "auto" | "trace" | "pi";
  toolName: string;
  minSessionDurationMs: number;
  minTotalLatencyMs: number;
  minToolResultCount: number;
  evalRatio: number;
  minFamilyDisjointPairCount: number;
  outDir: string;
  sessionIdPrefix: string;
  requireTaskPairs: boolean;
  strict: boolean;
} {
  const options = {
    tasks: ".happy-paths/benchmarks/swebench_lite_50/tasks.json",
    traceRoot: ".happy-paths/benchmarks/swebench_lite_50/traces",
    format: "trace" as const,
    toolName: "bash",
    minSessionDurationMs: 1_000,
    minTotalLatencyMs: 0,
    minToolResultCount: 2,
    evalRatio: 0.3,
    minFamilyDisjointPairCount: 20,
    outDir: ".happy-paths/benchmarks/swebench_lite_50/results",
    sessionIdPrefix: "swebench",
    requireTaskPairs: false,
    strict: false,
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
    if (token === "--require-task-pairs") {
      options.requireTaskPairs = true;
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

function summarizeSessions(
  sessionsById: Map<string, TraceEvent[]>,
): Map<string, SessionAggregate> {
  const output = new Map<string, SessionAggregate>();

  for (const [sessionId, events] of sessionsById.entries()) {
    let totalFailures = 0;
    let harmfulFailures = 0;
    let wallTimeMs = 0;
    let tokenCount = 0;

    for (const event of events) {
      wallTimeMs += event.metrics?.latencyMs ?? 0;
      tokenCount += eventTokenCount(event);

      if (!isFailure(event)) {
        continue;
      }

      totalFailures += 1;
      const issue = classifyTrajectoryIssue(event);
      if (issue?.harmful) {
        harmfulFailures += 1;
      }
    }

    output.set(sessionId, {
      sessionId,
      eventCount: events.length,
      totalFailures,
      harmfulFailures,
      wallTimeMs,
      tokenCount,
    });
  }

  return output;
}

function buildTaskPairedTrajectorySummary(options: {
  sessionAggregates: Map<string, SessionAggregate>;
  sessionIdPrefix: string;
}): TaskPairedTrajectorySummary {
  const identities = [...options.sessionAggregates.keys()]
    .map((sessionId) => parseSweBenchSessionId(sessionId, options.sessionIdPrefix))
    .filter((identity): identity is NonNullable<typeof identity> => identity !== null);

  const pairing = pairSweBenchSessions(identities);

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

  const harmfulRetryRateOff = failuresOff <= 0 ? 0 : harmfulOff / failuresOff;
  const harmfulRetryRateOn = failuresOn <= 0 ? 0 : harmfulOn / failuresOn;

  return {
    sessionIdFormat: `${options.sessionIdPrefix}::<instance_id>::<off|on>::<replicate>`,
    parsedSessionCount: identities.length,
    unparsedSessionCount: Math.max(
      0,
      options.sessionAggregates.size - identities.length,
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const outDir = resolve(repoRoot, options.outDir);
  const observedOut = resolve(outDir, "observed_ab_report.json");
  const trajectoryOut = resolve(outDir, "trajectory_outcome_report.json");
  const summaryOut = resolve(outDir, "summary.json");

  const taskPackPath = resolve(repoRoot, options.tasks);
  const traceRootPath = resolve(repoRoot, options.traceRoot);

  await mkdir(outDir, { recursive: true });

  const taskPack = parseTaskPack(await readFile(taskPackPath, "utf-8"));

  const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");

  const observedArgs = [
    "scripts/run-observed-ab-long-horizon.ts",
    "--trace-root",
    traceRootPath,
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
    traceRootPath,
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

  const sessionData = await loadSessions(traceRootPath);
  const sessionAggregates = summarizeSessions(sessionData.sessionsById);
  const taskPairedTrajectory = buildTaskPairedTrajectorySummary({
    sessionAggregates,
    sessionIdPrefix: options.sessionIdPrefix,
  });

  if (options.requireTaskPairs && taskPairedTrajectory.pairedRunCountWithMetrics < 1) {
    throw new Error(
      `no task-paired swebench trajectories found; use session IDs like '${taskPairedTrajectory.sessionIdFormat}'`,
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
    traceRoot: traceRootPath,
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
      observedLongHorizonPairCount: observedPairCount,
      trajectoryLongHorizonPairCount: trajectoryPairCount,
      longHorizonPairabilitySparse: observedPairCount < 3 || trajectoryPairCount < 3,
    },
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
    taskPairedTrajectory,
  };

  await mkdir(dirname(summaryOut), { recursive: true });
  await writeFile(summaryOut, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");

  if (observedPairCount < 3 || trajectoryPairCount < 3) {
    console.log(
      "NOTE: long-horizon pair counts are sparse; treat taskPairedTrajectory as the primary causal lane for this run.",
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
        taskPairedTrajectory: {
          parsedSessionCount: taskPairedTrajectory.parsedSessionCount,
          pairedRunCountWithMetrics: taskPairedTrajectory.pairedRunCountWithMetrics,
          relativeHarmfulRetryReduction:
            taskPairedTrajectory.relativeHarmfulRetryReduction,
          relativeWallTimeReduction: taskPairedTrajectory.relativeWallTimeReduction,
          relativeTokenCountReduction: taskPairedTrajectory.relativeTokenCountReduction,
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
