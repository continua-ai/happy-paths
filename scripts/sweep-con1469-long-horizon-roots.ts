#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type TraceInputFormat = "auto" | "trace" | "pi";

type Candidate = {
  label: string;
  traceRoot: string;
  format: TraceInputFormat;
  toolName: string;
};

type Options = {
  candidates: Candidate[];
  outJson: string;
  outMarkdown: string;
  minSessionDurationMs: number;
  minTotalLatencyMs: number;
  minToolResultCount: number;
  evalRatio: number;
};

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

type TrajectoryLane = {
  aggregate: {
    totalPairs: number;
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
  laneReports?: Record<string, TrajectoryLane>;
};

type CandidateResult = {
  candidate: Candidate;
  observed: {
    generatedAtUtc: string;
    pairCount: number;
    gatePass: boolean;
    deadEndReduction: number;
    wallTimeReduction: number;
    tokenCountReduction: number;
    failures: string[];
  };
  trajectory: {
    generatedAtUtc: string;
    primaryLane: string;
    pairCount: number;
    gatePass: boolean;
    harmfulRetryReduction: number;
    wallTimeReduction: number;
    tokenCountReduction: number;
    judgeableCoverageOn: number;
    failures: string[];
    fullEvalPairCount: number | null;
    familyDisjointPairCount: number | null;
  };
  score: number;
};

type SweepSummary = {
  generatedAtUtc: string;
  options: {
    minSessionDurationMs: number;
    minTotalLatencyMs: number;
    minToolResultCount: number;
    evalRatio: number;
  };
  results: CandidateResult[];
  bestByScore: CandidateResult | null;
};

function parseFormat(value: string): TraceInputFormat {
  if (value === "auto" || value === "trace" || value === "pi") {
    return value;
  }
  throw new Error(`invalid format: ${value}`);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid numeric value for ${flag}: ${value}`);
  }
  return parsed;
}

function expandHome(value: string): string {
  if (!value.startsWith("~/")) {
    return value;
  }
  return path.join(process.env.HOME ?? "", value.slice(2));
}

function parseCandidate(value: string): Candidate {
  const [labelRaw, rootRaw, formatRaw, toolNameRaw] = value
    .split("|")
    .map((part) => part.trim());

  if (!labelRaw || !rootRaw || !formatRaw) {
    throw new Error(
      `invalid --candidate '${value}'. expected 'label|traceRoot|format|toolName'`,
    );
  }

  return {
    label: labelRaw,
    traceRoot: path.resolve(expandHome(rootRaw)),
    format: parseFormat(formatRaw),
    toolName: toolNameRaw || "bash",
  };
}

function parseArgs(argv: string[]): Options {
  const repoRoot = process.cwd();
  const candidates: Candidate[] = [];

  const options: Options = {
    candidates,
    outJson: path.resolve(repoRoot, ".happy-paths/con1469-loop/latest-sweep.json"),
    outMarkdown: path.resolve(repoRoot, ".happy-paths/con1469-loop/latest-sweep.md"),
    minSessionDurationMs: 1000,
    minTotalLatencyMs: 0,
    minToolResultCount: 2,
    evalRatio: 0.3,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--candidate") {
      candidates.push(parseCandidate(String(value)));
      index += 1;
      continue;
    }
    if (token === "--out-json") {
      options.outJson = path.resolve(repoRoot, String(value));
      index += 1;
      continue;
    }
    if (token === "--out-markdown") {
      options.outMarkdown = path.resolve(repoRoot, String(value));
      index += 1;
      continue;
    }
    if (token === "--min-session-duration-ms") {
      options.minSessionDurationMs = parseNumber(String(value), token);
      index += 1;
      continue;
    }
    if (token === "--min-total-latency-ms") {
      options.minTotalLatencyMs = parseNumber(String(value), token);
      index += 1;
      continue;
    }
    if (token === "--min-tool-result-count") {
      options.minToolResultCount = parseNumber(String(value), token);
      index += 1;
      continue;
    }
    if (token === "--eval-ratio") {
      options.evalRatio = parseNumber(String(value), token);
      index += 1;
    }
  }

  if (options.candidates.length === 0) {
    options.candidates.push(
      parseCandidate("happy-paths|.happy-paths|trace|bash"),
      parseCandidate("pi-sessions|~/.pi/agent/sessions|pi|bash"),
    );
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

function scoreResult(observed: ObservedReport, trajectory: TrajectoryReport): number {
  const observedPairs = observed.aggregate.totalPairs;
  const trajectoryPairs = trajectory.aggregate.totalPairs;

  return (
    observed.aggregate.relativeWallTimeReduction * 2 +
    observed.aggregate.relativeTokenCountReduction * 1.5 +
    observed.aggregate.relativeRepeatedDeadEndRateReduction * 3 +
    trajectory.aggregate.relativeHarmfulRetryReduction * 3 +
    trajectory.aggregate.relativeWallTimeReduction * 2 +
    trajectory.aggregate.relativeTokenCountReduction * 1.5 +
    trajectory.aggregate.judgeableCoverageOn * 1 +
    Math.min(observedPairs, 500) / 500 +
    Math.min(trajectoryPairs, 200) / 200
  );
}

function formatEasternIso(utcIso: string): string {
  const date = new Date(utcIso);
  if (!Number.isFinite(date.getTime())) {
    return utcIso;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(date);

  const values = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== "literal") {
      values.set(part.type, part.value);
    }
  }

  const offsetRaw = values.get("timeZoneName") ?? "GMT+00:00";
  const offsetMatch = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(offsetRaw);
  const sign = offsetMatch ? offsetMatch[1] : "+";
  const hour = offsetMatch ? offsetMatch[2].padStart(2, "0") : "00";
  const minute = offsetMatch ? (offsetMatch[3] ?? "00").padStart(2, "0") : "00";
  const offset = `${sign}${hour}:${minute}`;

  const year = values.get("year") ?? "0000";
  const month = values.get("month") ?? "01";
  const day = values.get("day") ?? "01";
  const hourPart = values.get("hour") ?? "00";
  const minutePart = values.get("minute") ?? "00";
  const secondPart = values.get("second") ?? "00";

  return `${year}-${month}-${day}T${hourPart}:${minutePart}:${secondPart}${offset}`;
}

function formatUtcWithEastern(utcIso: string): string {
  return `${utcIso} (US/Eastern: ${formatEasternIso(utcIso)})`;
}

function toMarkdown(summary: SweepSummary): string {
  const lines: string[] = [];
  lines.push("CON-1469 long-horizon corpus sweep");
  lines.push("");
  lines.push(`- generatedAtUtc: ${formatUtcWithEastern(summary.generatedAtUtc)}`);
  lines.push(
    `- params: minSessionDurationMs=${summary.options.minSessionDurationMs}, minTotalLatencyMs=${summary.options.minTotalLatencyMs}, minToolResultCount=${summary.options.minToolResultCount}, evalRatio=${summary.options.evalRatio}`,
  );
  if (summary.bestByScore) {
    lines.push(
      `- bestByScore: ${summary.bestByScore.candidate.label} (score=${summary.bestByScore.score.toFixed(3)})`,
    );
  }
  lines.push("");

  for (const result of summary.results) {
    lines.push(`## ${result.candidate.label}`);
    lines.push(
      `- input: ${result.candidate.traceRoot} (${result.candidate.format}, tool=${result.candidate.toolName})`,
    );
    lines.push(`- score: ${result.score.toFixed(3)}`);
    lines.push(
      `- observed: pairs=${result.observed.pairCount}, gate=${result.observed.gatePass}, dead/wall/token=${result.observed.deadEndReduction.toFixed(3)}/${result.observed.wallTimeReduction.toFixed(3)}/${result.observed.tokenCountReduction.toFixed(3)}`,
    );
    lines.push(
      `- trajectory: lane=${result.trajectory.primaryLane}, pairs(primary/full/disjoint)=${result.trajectory.pairCount}/${result.trajectory.fullEvalPairCount ?? 0}/${result.trajectory.familyDisjointPairCount ?? 0}, gate=${result.trajectory.gatePass}, harmful/wall/token=${result.trajectory.harmfulRetryReduction.toFixed(3)}/${result.trajectory.wallTimeReduction.toFixed(3)}/${result.trajectory.tokenCountReduction.toFixed(3)}, judgeableOn=${result.trajectory.judgeableCoverageOn.toFixed(3)}`,
    );
    if (result.observed.failures.length > 0) {
      lines.push(`- observed failures: ${result.observed.failures.join("; ")}`);
    }
    if (result.trajectory.failures.length > 0) {
      lines.push(`- trajectory failures: ${result.trajectory.failures.join("; ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const tempDir = path.join(
    os.tmpdir(),
    `con1469-long-horizon-sweep-${Date.now().toString()}`,
  );
  await mkdir(tempDir, { recursive: true });

  const results: CandidateResult[] = [];

  for (const candidate of options.candidates) {
    const observedOutPath = path.join(tempDir, `${candidate.label}-observed.json`);
    const trajectoryOutPath = path.join(tempDir, `${candidate.label}-trajectory.json`);

    console.log(
      `\n=== candidate: ${candidate.label} (${candidate.traceRoot}, ${candidate.format}) ===`,
    );

    runCommand(repoRoot, "npx", [
      "tsx",
      "scripts/run-observed-ab-long-horizon.ts",
      "--trace-root",
      candidate.traceRoot,
      "--format",
      candidate.format,
      "--tool-name",
      candidate.toolName,
      "--min-session-duration-ms",
      String(options.minSessionDurationMs),
      "--min-total-latency-ms",
      String(options.minTotalLatencyMs),
      "--min-tool-result-count",
      String(options.minToolResultCount),
      "--eval-ratio",
      String(options.evalRatio),
      "--out",
      observedOutPath,
    ]);

    runCommand(repoRoot, "npx", [
      "tsx",
      "scripts/run-trajectory-outcome-long-horizon.ts",
      "--trace-root",
      candidate.traceRoot,
      "--format",
      candidate.format,
      "--tool-name",
      candidate.toolName,
      "--min-session-duration-ms",
      String(options.minSessionDurationMs),
      "--min-total-latency-ms",
      String(options.minTotalLatencyMs),
      "--min-tool-result-count",
      String(options.minToolResultCount),
      "--eval-ratio",
      String(options.evalRatio),
      "--primary-lane",
      "family_disjoint_eval",
      "--out",
      trajectoryOutPath,
    ]);

    const observed = await readJsonFile<ObservedReport>(observedOutPath);
    const trajectory = await readJsonFile<TrajectoryReport>(trajectoryOutPath);
    const primaryLane = trajectory.primaryLane ?? "full_eval";

    const result: CandidateResult = {
      candidate,
      observed: {
        generatedAtUtc: observed.generatedAtUtc,
        pairCount: observed.aggregate.totalPairs,
        gatePass: observed.gateResult.pass,
        deadEndReduction: observed.aggregate.relativeRepeatedDeadEndRateReduction,
        wallTimeReduction: observed.aggregate.relativeWallTimeReduction,
        tokenCountReduction: observed.aggregate.relativeTokenCountReduction,
        failures: observed.gateResult.failures,
      },
      trajectory: {
        generatedAtUtc: trajectory.generatedAtUtc,
        primaryLane,
        pairCount: trajectory.aggregate.totalPairs,
        gatePass: trajectory.gateResult.pass,
        harmfulRetryReduction: trajectory.aggregate.relativeHarmfulRetryReduction,
        wallTimeReduction: trajectory.aggregate.relativeWallTimeReduction,
        tokenCountReduction: trajectory.aggregate.relativeTokenCountReduction,
        judgeableCoverageOn: trajectory.aggregate.judgeableCoverageOn,
        failures: trajectory.gateResult.failures,
        fullEvalPairCount:
          trajectory.laneReports?.full_eval?.aggregate.totalPairs ?? null,
        familyDisjointPairCount:
          trajectory.laneReports?.family_disjoint_eval?.aggregate.totalPairs ?? null,
      },
      score: scoreResult(observed, trajectory),
    };

    results.push(result);
  }

  results.sort((left, right) => right.score - left.score);
  const summary: SweepSummary = {
    generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    options: {
      minSessionDurationMs: options.minSessionDurationMs,
      minTotalLatencyMs: options.minTotalLatencyMs,
      minToolResultCount: options.minToolResultCount,
      evalRatio: options.evalRatio,
    },
    results,
    bestByScore: results[0] ?? null,
  };

  await mkdir(path.dirname(options.outJson), { recursive: true });
  await writeFile(options.outJson, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");

  const markdown = toMarkdown(summary);
  await mkdir(path.dirname(options.outMarkdown), { recursive: true });
  await writeFile(options.outMarkdown, `${markdown}\n`, "utf-8");

  console.log(
    JSON.stringify(
      {
        generatedAtUtc: summary.generatedAtUtc,
        candidateCount: summary.results.length,
        bestByScore: summary.bestByScore?.candidate.label ?? null,
        outJson: options.outJson,
        outMarkdown: options.outMarkdown,
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
