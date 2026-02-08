#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type RunManifestThresholds = {
  minDeadEndReduction: number;
  minWallTimeReduction: number;
  minTokenProxyReduction: number;
  minRecoverySuccessOn: number;
  maxRecoverySuccessRateDrop: number;
};

type RunManifestDefinition = {
  id: string;
  title: string;
  detail: string;
};

type RunManifestExperimentStep = {
  id: string;
  label: string;
  description: string;
  datasetSources: string[];
};

type RunManifestExperimentPlan = {
  summary: string;
  offMode: string;
  onMode: string;
  assistFactorByRank: string[];
  steps: RunManifestExperimentStep[];
};

type RunManifestRun = {
  id: string;
  label: string;
  recordedAtUtc: string;
  command: string;
  datasetSources: string[];
  reportFile: string;
};

type RunManifest = {
  schemaVersion: 2;
  generatedAtUtc: string;
  thresholds: RunManifestThresholds;
  definitions: RunManifestDefinition[];
  experimentPlan: RunManifestExperimentPlan;
  runs: RunManifestRun[];
};

type TraceInputFormat = "auto" | "trace" | "pi";

type Options = {
  webRepoRoot: string;
  traceRoot: string;
  piSessionRoot: string;
  includePiSession: boolean;
  harness: string;
  scope: "personal" | "team" | "public";
  longHorizonTraceRoot: string;
  longHorizonFormat: TraceInputFormat;
  longHorizonToolName: string;
  minFamilyDisjointPairCount: number;
};

type RunPlan = {
  idBase: string;
  label: string;
  description: string;
  datasetSources: string[];
  additionalDatasets: string[];
};

type ObservedAbInterval = {
  low: number;
  median: number;
  high: number;
};

type RawObservedAbLongHorizonReport = {
  schemaVersion: number;
  generatedAtUtc: string;
  traceRoot: string;
  format: string;
  toolName: string;
  files: {
    traceFilesFound: number;
    traceEventFilesScanned: number;
    piSessionFilesScanned: number;
    skippedForFormat: number;
  };
  holdout: {
    minSessionDurationMs: number;
    minTotalLatencyMs: number;
    minToolResultCount: number;
    evalRatio: number;
    totalSessionsParsed: number;
    totalLongHorizonSessions: number;
    trainSessionCount: number;
    evalSessionCount: number;
    familyOverlap: {
      trainFamilyCount: number;
      evalFamilyCount: number;
      overlappingFamilyCount: number;
      overlapRateByEvalFamilies: number;
      overlapRateByTrainFamilies: number;
    };
  };
  trainEpisodeCount: number;
  evalEpisodeCount: number;
  thresholds: {
    minPairCount: number;
    minRelativeDeadEndReduction: number;
    minRelativeWallTimeReduction: number;
    minRelativeTokenCountReduction: number;
    minRelativeTokenProxyReduction: number;
    minRecoverySuccessRateOn: number;
    maxRecoverySuccessRateDrop: number;
  };
  pairing: {
    minOccurrencesPerFamily: number;
    requireCrossSession: boolean;
    maxWallTimeRatio: number;
    maxTokenCountRatio: number;
  };
  pairingDiagnostics: {
    familiesSeen: number;
    familiesEligible: number;
    candidateTransitions: number;
    droppedSameSession: number;
    droppedOutlierRatio: number;
    pairsBuilt: number;
  };
  aggregate: {
    totalPairs: number;
    totalRetriesOff: number;
    totalRetriesOn: number;
    repeatedDeadEndRateOff: number;
    repeatedDeadEndRateOn: number;
    recoverySuccessRateOff: number;
    recoverySuccessRateOn: number;
    totalWallTimeOffMs: number;
    totalWallTimeOnMs: number;
    totalTokenCountOff: number;
    totalTokenCountOn: number;
    totalCostOffUsd: number;
    totalCostOnUsd: number;
    relativeRepeatedDeadEndRateReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
    absoluteRecoverySuccessRateDelta: number;
  };
  trustSummary: {
    method: string;
    sampleCount: number;
    confidenceLevel: number;
    deadEndReduction: ObservedAbInterval;
    wallTimeReduction: ObservedAbInterval;
    tokenCountReduction: ObservedAbInterval;
    expectedDeadEndsAvoided: ObservedAbInterval;
  };
  gateResult: {
    pass: boolean;
    failures: string[];
  };
};

type ObservedAbEvidence = {
  schemaVersion: 1;
  generatedAtUtc: string;
  run: {
    id: string;
    label: string;
    command: string;
    dataSource: string;
    format: string;
    toolName: string;
  };
  methodology: {
    summary: string;
    pairingAlgorithm: string[];
    privacyNote: string;
  };
  thresholds: {
    minPairCount: number;
    minRelativeDeadEndReduction: number;
    minRelativeWallTimeReduction: number;
    minRelativeTokenCountReduction: number;
    minRecoverySuccessRateOn: number;
    maxRecoverySuccessRateDrop: number;
  };
  pairing: {
    minOccurrencesPerFamily: number;
    requireCrossSession: boolean;
    maxWallTimeRatio: number;
    maxTokenCountRatio: number;
  };
  pairingDiagnostics: {
    familiesSeen: number;
    familiesEligible: number;
    candidateTransitions: number;
    droppedSameSession: number;
    droppedOutlierRatio: number;
    pairsBuilt: number;
  };
  aggregate: {
    totalPairs: number;
    totalRetriesOff: number;
    totalRetriesOn: number;
    repeatedDeadEndRateOff: number;
    repeatedDeadEndRateOn: number;
    recoverySuccessRateOff: number;
    recoverySuccessRateOn: number;
    totalWallTimeOffMs: number;
    totalWallTimeOnMs: number;
    totalTokenCountOff: number;
    totalTokenCountOn: number;
    totalCostOffUsd: number;
    totalCostOnUsd: number;
    relativeRepeatedDeadEndRateReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
    absoluteRecoverySuccessRateDelta: number;
  };
  trustSummary: {
    method: string;
    sampleCount: number;
    confidenceLevel: number;
    deadEndReduction: ObservedAbInterval;
    wallTimeReduction: ObservedAbInterval;
    tokenCountReduction: ObservedAbInterval;
    expectedDeadEndsAvoided: ObservedAbInterval;
  };
  gateResult: {
    pass: boolean;
    failures: string[];
  };
};

type RawTrajectoryOutcomeReport = {
  schemaVersion: number;
  generatedAtUtc: string;
  traceRoot: string;
  format: string;
  toolName: string;
  files: {
    traceFilesFound: number;
    traceEventFilesScanned: number;
    piSessionFilesScanned: number;
    skippedForFormat: number;
  };
  holdout: {
    minSessionDurationMs: number;
    minTotalLatencyMs: number;
    minToolResultCount: number;
    evalRatio: number;
    totalSessionsParsed: number;
    totalLongHorizonSessions: number;
    trainSessionCount: number;
    evalSessionCount: number;
    familyOverlap: {
      trainFamilyCount: number;
      evalFamilyCount: number;
      overlappingFamilyCount: number;
      overlapRateByEvalFamilies: number;
      overlapRateByTrainFamilies: number;
    };
  };
  trainEpisodeCount: number;
  evalEpisodeCount: number;
  thresholds: Record<string, unknown>;
  pairing: Record<string, unknown>;
  pairingDiagnostics: Record<string, unknown>;
  aggregate: Record<string, unknown>;
  trustSummary: Record<string, unknown>;
  gateResult: {
    pass: boolean;
    failures: string[];
  };
};
const DEFAULT_PI_SESSION_ROOT = path.join(
  process.env.HOME || "",
  ".pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469--",
);

const THRESHOLDS: RunManifestThresholds = {
  minDeadEndReduction: 0.25,
  minWallTimeReduction: 0.1,
  minTokenProxyReduction: 0.1,
  minRecoverySuccessOn: 0.9,
  maxRecoverySuccessRateDrop: 0,
};

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseTraceInputFormat(value: string): TraceInputFormat {
  if (value === "auto" || value === "trace" || value === "pi") {
    return value;
  }
  throw new Error(`invalid trace format: ${value}`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    webRepoRoot: path.resolve(process.cwd(), "../happy-paths-web"),
    traceRoot: ".happy-paths/feasibility-run",
    piSessionRoot: DEFAULT_PI_SESSION_ROOT,
    includePiSession: true,
    harness: "pi",
    scope: "personal",
    longHorizonTraceRoot: ".happy-paths",
    longHorizonFormat: "trace",
    longHorizonToolName: "bash",
    minFamilyDisjointPairCount: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--web-repo-root") {
      options.webRepoRoot = path.resolve(process.cwd(), String(value));
      index += 1;
      continue;
    }
    if (token === "--trace-root") {
      options.traceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--pi-session-root") {
      options.piSessionRoot = path.resolve(String(value));
      index += 1;
      continue;
    }
    if (token === "--include-pi-session") {
      options.includePiSession = parseBoolean(String(value));
      index += 1;
      continue;
    }
    if (token === "--long-horizon-trace-root") {
      options.longHorizonTraceRoot = path.resolve(String(value));
      index += 1;
      continue;
    }
    if (token === "--long-horizon-format") {
      options.longHorizonFormat = parseTraceInputFormat(String(value));
      index += 1;
      continue;
    }
    if (token === "--long-horizon-tool-name") {
      options.longHorizonToolName = String(value);
      index += 1;
      continue;
    }
    if (token === "--min-family-disjoint-pair-count") {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(
          `invalid --min-family-disjoint-pair-count value: ${String(value)}`,
        );
      }
      options.minFamilyDisjointPairCount = Math.max(0, parsed);
      index += 1;
      continue;
    }
    if (token === "--harness") {
      options.harness = String(value);
      index += 1;
      continue;
    }
    if (token === "--scope") {
      const scope = String(value);
      if (scope !== "personal" && scope !== "team" && scope !== "public") {
        throw new Error(`invalid --scope value: ${scope}`);
      }
      options.scope = scope;
      index += 1;
    }
  }

  return options;
}

function runCommand(cwd: string, command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      [
        `Command failed (${result.status}): ${command} ${args.join(" ")}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return result.stdout || "";
}

async function ensureWebRepo(pathToRepo: string): Promise<void> {
  const packageJsonPath = path.join(pathToRepo, "package.json");
  const generatorPath = path.join(
    pathToRepo,
    "scripts/generate_feasibility_evidence.ts",
  );

  if (!existsSync(packageJsonPath)) {
    throw new Error(`web repo package.json not found: ${packageJsonPath}`);
  }
  if (!existsSync(generatorPath)) {
    throw new Error(`web generator script not found: ${generatorPath}`);
  }
}

async function clearJsonFiles(directoryPath: string): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".json")) {
      continue;
    }
    await unlink(path.join(directoryPath, entry.name));
  }
}

function timestampSlug(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "z");
}

function buildDefinitions(thresholds: RunManifestThresholds): RunManifestDefinition[] {
  return [
    {
      id: "off-mode",
      title: "OFF retrieval",
      detail:
        "Suggest with no prior captured history for the scenario. This is the cold-start baseline.",
    },
    {
      id: "on-mode",
      title: "ON retrieval",
      detail:
        "Ingest the scenario’s failure→recovery trace first, then suggest. This measures learned reuse.",
    },
    {
      id: "fixture",
      title: "Fixture dataset",
      detail:
        "A small canonical synthetic scenario set used for repeatable baseline checks. Fixtures are safe to publish.",
    },
    {
      id: "table-arrow",
      title: "Down-arrow columns (↓)",
      detail:
        "Columns labeled with ↓ are relative reductions versus OFF baseline. Bigger percentages are better.",
    },
    {
      id: "hit-at-1",
      title: "hit@1",
      detail:
        "Fraction of scenarios where the first suggestion matches an expected recovery phrase.",
    },
    {
      id: "hit-at-3",
      title: "hit@3",
      detail:
        "Fraction of scenarios where any top-3 suggestion matches an expected recovery phrase.",
    },
    {
      id: "mrr",
      title: "MRR",
      detail:
        "Mean reciprocal rank of the first matching suggestion (0 when no match).",
    },
    {
      id: "dead-end-reduction",
      title: "Relative repeated dead-end reduction",
      detail: `Computed as (off - on) / off over repeated-dead-end rate. Gate threshold: >= ${thresholds.minDeadEndReduction.toFixed(2)}.`,
    },
    {
      id: "dead-end-count-estimate",
      title: "Estimated repeated dead-end count",
      detail:
        "Estimated as repeatedDeadEndRate × scenarioCount, shown as OFF → ON and avoided counts.",
    },
    {
      id: "wall-time-reduction",
      title: "Relative wall-time proxy reduction",
      detail: `Computed as (off - on) / off over wall-time proxy. Gate threshold: >= ${thresholds.minWallTimeReduction.toFixed(2)}.`,
    },
    {
      id: "token-reduction",
      title: "Relative token-proxy reduction",
      detail: `Computed as (off - on) / off over token proxy. Gate threshold: >= ${thresholds.minTokenProxyReduction.toFixed(2)}.`,
    },
    {
      id: "recovery-success",
      title: "Recovery success on",
      detail: `Success rate in ON mode; must remain >= ${thresholds.minRecoverySuccessOn.toFixed(2)} with drop <= ${thresholds.maxRecoverySuccessRateDrop.toFixed(2)}.`,
    },
    {
      id: "assist-factor",
      title: "Assist factor model",
      detail:
        "Conservative proxy for expected gain from retrieval rank: rank1=1.0, rank2=0.6, rank3=0.35, otherwise 0.0.",
    },
  ];
}

function sanitizeDatasetSource(value: string): string {
  const homeDirectory = process.env.HOME;
  if (homeDirectory && value.startsWith(homeDirectory)) {
    return `~${value.slice(homeDirectory.length)}`;
  }
  return value;
}

function runIdFromGeneratedAt(value: string): string {
  return value
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}

function buildObservedAbRunCommand(raw: RawObservedAbLongHorizonReport): string {
  return [
    "npx tsx scripts/run-observed-ab-long-horizon.ts",
    `--trace-root ${sanitizeDatasetSource(raw.traceRoot)}`,
    `--format ${raw.format}`,
    `--tool-name ${raw.toolName}`,
    `--min-session-duration-ms ${raw.holdout.minSessionDurationMs}`,
    `--min-total-latency-ms ${raw.holdout.minTotalLatencyMs}`,
    `--min-tool-result-count ${raw.holdout.minToolResultCount}`,
    `--eval-ratio ${raw.holdout.evalRatio}`,
    "--json",
  ].join(" ");
}

function toObservedAbEvidence(raw: RawObservedAbLongHorizonReport): ObservedAbEvidence {
  return {
    schemaVersion: 1,
    generatedAtUtc: raw.generatedAtUtc,
    run: {
      id: `observed-ab-long-horizon-${runIdFromGeneratedAt(raw.generatedAtUtc)}`,
      label: "Observed A/B long-horizon holdout (measured OFF vs ON)",
      command: buildObservedAbRunCommand(raw),
      dataSource: sanitizeDatasetSource(raw.traceRoot),
      format: raw.format,
      toolName: raw.toolName,
    },
    methodology: {
      summary:
        "Measured OFF/ON comparisons built from repeated recovery families across sessions. OFF and ON are both observed episodes (no modeled replay in this section).",
      pairingAlgorithm: [
        "Extract recovery episodes from trace events (failure-to-success chains).",
        "Group episodes by normalized family signature (command/error pattern).",
        "Split long-horizon sessions chronologically into train/eval and evaluate only eval episodes.",
        "Build adjacent OFF→ON transitions per family, preferring cross-session pairs.",
        "Drop outliers with wall-time/token-count ratio filters.",
        "Compute aggregate measured deltas and paired-bootstrap confidence intervals.",
      ],
      privacyNote:
        "Public view includes only aggregate metrics and diagnostics; raw private trace content is not displayed.",
    },
    thresholds: {
      minPairCount: raw.thresholds.minPairCount,
      minRelativeDeadEndReduction: raw.thresholds.minRelativeDeadEndReduction,
      minRelativeWallTimeReduction: raw.thresholds.minRelativeWallTimeReduction,
      minRelativeTokenCountReduction: raw.thresholds.minRelativeTokenCountReduction,
      minRecoverySuccessRateOn: raw.thresholds.minRecoverySuccessRateOn,
      maxRecoverySuccessRateDrop: raw.thresholds.maxRecoverySuccessRateDrop,
    },
    pairing: {
      minOccurrencesPerFamily: raw.pairing.minOccurrencesPerFamily,
      requireCrossSession: true,
      maxWallTimeRatio: raw.pairing.maxWallTimeRatio,
      maxTokenCountRatio: raw.pairing.maxTokenCountRatio,
    },
    pairingDiagnostics: raw.pairingDiagnostics,
    aggregate: {
      totalPairs: raw.aggregate.totalPairs,
      totalRetriesOff: raw.aggregate.totalRetriesOff,
      totalRetriesOn: raw.aggregate.totalRetriesOn,
      repeatedDeadEndRateOff: raw.aggregate.repeatedDeadEndRateOff,
      repeatedDeadEndRateOn: raw.aggregate.repeatedDeadEndRateOn,
      recoverySuccessRateOff: raw.aggregate.recoverySuccessRateOff,
      recoverySuccessRateOn: raw.aggregate.recoverySuccessRateOn,
      totalWallTimeOffMs: raw.aggregate.totalWallTimeOffMs,
      totalWallTimeOnMs: raw.aggregate.totalWallTimeOnMs,
      totalTokenCountOff: raw.aggregate.totalTokenCountOff,
      totalTokenCountOn: raw.aggregate.totalTokenCountOn,
      totalCostOffUsd: raw.aggregate.totalCostOffUsd,
      totalCostOnUsd: raw.aggregate.totalCostOnUsd,
      relativeRepeatedDeadEndRateReduction:
        raw.aggregate.relativeRepeatedDeadEndRateReduction,
      relativeWallTimeReduction: raw.aggregate.relativeWallTimeReduction,
      relativeTokenCountReduction: raw.aggregate.relativeTokenCountReduction,
      absoluteRecoverySuccessRateDelta: raw.aggregate.absoluteRecoverySuccessRateDelta,
    },
    trustSummary: {
      method: raw.trustSummary.method,
      sampleCount: raw.trustSummary.sampleCount,
      confidenceLevel: raw.trustSummary.confidenceLevel,
      deadEndReduction: raw.trustSummary.deadEndReduction,
      wallTimeReduction: raw.trustSummary.wallTimeReduction,
      tokenCountReduction: raw.trustSummary.tokenCountReduction,
      expectedDeadEndsAvoided: raw.trustSummary.expectedDeadEndsAvoided,
    },
    gateResult: raw.gateResult,
  };
}

function sanitizeTrajectoryOutcomeReportForWeb(
  raw: RawTrajectoryOutcomeReport,
): RawTrajectoryOutcomeReport {
  return {
    ...raw,
    holdout: {
      minSessionDurationMs: raw.holdout.minSessionDurationMs,
      minTotalLatencyMs: raw.holdout.minTotalLatencyMs,
      minToolResultCount: raw.holdout.minToolResultCount,
      evalRatio: raw.holdout.evalRatio,
      totalSessionsParsed: raw.holdout.totalSessionsParsed,
      totalLongHorizonSessions: raw.holdout.totalLongHorizonSessions,
      trainSessionCount: raw.holdout.trainSessionCount,
      evalSessionCount: raw.holdout.evalSessionCount,
      familyOverlap: raw.holdout.familyOverlap,
    },
  };
}

function buildExperimentPlan(
  steps: RunManifestExperimentStep[],
): RunManifestExperimentPlan {
  return {
    summary:
      "Each run evaluates the same wrong-turn scenarios in OFF and ON modes, then computes retrieval and efficiency deltas against explicit thresholds.",
    offMode:
      "OFF mode runs retrieval without prior scenario history to represent cold-start behavior.",
    onMode:
      "ON mode ingests scenario traces first, then runs retrieval to measure learned reuse from prior recoveries.",
    assistFactorByRank: [
      "rank 1 => 1.0",
      "rank 2 => 0.6",
      "rank 3 => 0.35",
      "no top-3 match => 0.0",
    ],
    steps,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const webRepoRoot = options.webRepoRoot;

  await ensureWebRepo(webRepoRoot);

  const now = new Date();
  const slug = timestampSlug(now);
  const tempDir = path.join(os.tmpdir(), `happy-paths-feasibility-${slug}`);
  await mkdir(tempDir, { recursive: true });

  const traceDatasetPath = path.join(tempDir, "trace_dataset.json");
  runCommand(repoRoot, "npm", [
    "run",
    "build:feasibility-dataset",
    "--",
    "--trace-root",
    options.traceRoot,
    "--format",
    "trace",
    "--harness",
    options.harness,
    "--scope",
    options.scope,
    "--out",
    traceDatasetPath,
  ]);

  let piDatasetPath: string | null = null;
  if (options.includePiSession && existsSync(options.piSessionRoot)) {
    piDatasetPath = path.join(tempDir, "pi_dataset.json");
    runCommand(repoRoot, "npm", [
      "run",
      "build:feasibility-dataset",
      "--",
      "--trace-root",
      options.piSessionRoot,
      "--format",
      "pi",
      "--tool-name",
      "bash",
      "--harness",
      options.harness,
      "--scope",
      options.scope,
      "--out",
      piDatasetPath,
    ]);
  }

  const runPlans: RunPlan[] = [
    {
      idBase: "fixture-strict",
      label: "Fixture-only strict gate",
      description: "Baseline run using only the canonical fixture dataset.",
      datasetSources: ["testdata/wrong_turn_dataset.json"],
      additionalDatasets: [],
    },
    {
      idBase: "fixture-plus-trace-sample",
      label: "Fixture + local trace sample",
      description:
        "Adds local trace-derived scenarios to validate extraction + memo flow.",
      datasetSources: [
        "testdata/wrong_turn_dataset.json",
        sanitizeDatasetSource(options.traceRoot),
      ],
      additionalDatasets: [traceDatasetPath],
    },
  ];

  if (piDatasetPath) {
    runPlans.push({
      idBase: "fixture-plus-pi-session",
      label: "Fixture + Pi session extraction",
      description:
        "Adds raw Pi-session-derived scenarios to stress-test feasibility on fresh real traces.",
      datasetSources: [
        "testdata/wrong_turn_dataset.json",
        sanitizeDatasetSource(options.piSessionRoot),
      ],
      additionalDatasets: [piDatasetPath],
    });
  }

  const evidenceRoot = path.join(webRepoRoot, "evidence/feasibility");
  const reportsRoot = path.join(evidenceRoot, "reports");
  await mkdir(reportsRoot, { recursive: true });
  await clearJsonFiles(reportsRoot);

  const runs: RunManifestRun[] = [];
  const experimentSteps: RunManifestExperimentStep[] = [];

  for (const [index, plan] of runPlans.entries()) {
    const runRecordedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const runId = `${plan.idBase}-${slug}`;
    const reportFilename = `r${index + 1}-${plan.idBase}-${slug}.json`;
    const reportPath = path.join(reportsRoot, reportFilename);

    const runDataDir = path.join(tempDir, `feasibility-run-${runId}`);
    const runArgs = [
      "tsx",
      "scripts/run-feasibility-gate.ts",
      "--json",
      "--dataset",
      "testdata/wrong_turn_dataset.json",
      "--data-dir",
      runDataDir,
      "--session-prefix",
      runId,
    ];

    for (const datasetPath of plan.additionalDatasets) {
      runArgs.push("--additional-dataset", datasetPath);
    }

    const raw = runCommand(repoRoot, "npx", runArgs);
    const parsed = JSON.parse(raw);
    await writeFile(reportPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");

    const commandPieces = [
      "npx tsx scripts/run-feasibility-gate.ts --json --dataset testdata/wrong_turn_dataset.json",
      ...plan.additionalDatasets.map((_, datasetIndex) => {
        return `--additional-dataset <generated-dataset-${datasetIndex + 1}>`;
      }),
    ];

    runs.push({
      id: runId,
      label: plan.label,
      recordedAtUtc: runRecordedAtUtc,
      command: commandPieces.join(" "),
      datasetSources: plan.datasetSources,
      reportFile: `reports/${reportFilename}`,
    });

    experimentSteps.push({
      id: runId,
      label: plan.label,
      description: plan.description,
      datasetSources: plan.datasetSources,
    });
  }

  const generatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const manifest: RunManifest = {
    schemaVersion: 2,
    generatedAtUtc,
    thresholds: THRESHOLDS,
    definitions: buildDefinitions(THRESHOLDS),
    experimentPlan: buildExperimentPlan(experimentSteps),
    runs,
  };

  const manifestPath = path.join(evidenceRoot, "run-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  const observedRawReportPath = path.join(tempDir, "observed_ab_long_horizon_raw.json");
  runCommand(repoRoot, "npx", [
    "tsx",
    "scripts/run-observed-ab-long-horizon.ts",
    "--trace-root",
    options.longHorizonTraceRoot,
    "--format",
    options.longHorizonFormat,
    "--tool-name",
    options.longHorizonToolName,
    "--min-session-duration-ms",
    "1000",
    "--min-total-latency-ms",
    "0",
    "--min-tool-result-count",
    "2",
    "--eval-ratio",
    "0.3",
    "--out",
    observedRawReportPath,
  ]);

  const observedRawReport = JSON.parse(
    await readFile(observedRawReportPath, "utf-8"),
  ) as RawObservedAbLongHorizonReport;
  if (observedRawReport.schemaVersion !== 1) {
    throw new Error(
      `unsupported observed A/B schema version: ${observedRawReport.schemaVersion}`,
    );
  }

  const observedEvidencePath = path.join(
    webRepoRoot,
    "evidence/observed_ab/report.json",
  );
  await mkdir(path.dirname(observedEvidencePath), { recursive: true });
  await writeFile(
    observedEvidencePath,
    `${JSON.stringify(toObservedAbEvidence(observedRawReport), null, 2)}\n`,
    "utf-8",
  );

  const trajectoryRawReportPath = path.join(
    tempDir,
    "trajectory_outcome_long_horizon_raw.json",
  );
  runCommand(repoRoot, "npx", [
    "tsx",
    "scripts/run-trajectory-outcome-long-horizon.ts",
    "--trace-root",
    options.longHorizonTraceRoot,
    "--format",
    options.longHorizonFormat,
    "--tool-name",
    options.longHorizonToolName,
    "--min-session-duration-ms",
    "1000",
    "--min-total-latency-ms",
    "0",
    "--min-tool-result-count",
    "2",
    "--eval-ratio",
    "0.3",
    "--min-family-disjoint-pair-count",
    String(options.minFamilyDisjointPairCount),
    "--out",
    trajectoryRawReportPath,
  ]);

  const trajectoryRawReport = JSON.parse(
    await readFile(trajectoryRawReportPath, "utf-8"),
  ) as RawTrajectoryOutcomeReport;
  if (trajectoryRawReport.schemaVersion !== 1) {
    throw new Error(
      `unsupported trajectory schema version: ${trajectoryRawReport.schemaVersion}`,
    );
  }

  const trajectoryEvidencePath = path.join(
    webRepoRoot,
    "evidence/trajectory_outcome/report.json",
  );
  await mkdir(path.dirname(trajectoryEvidencePath), { recursive: true });
  await writeFile(
    trajectoryEvidencePath,
    `${JSON.stringify(sanitizeTrajectoryOutcomeReportForWeb(trajectoryRawReport), null, 2)}\n`,
    "utf-8",
  );

  runCommand(webRepoRoot, "npm", ["run", "generate:evidence"]);

  const publicDataPath = path.join(
    webRepoRoot,
    "public/evidence/feasibility-runs.json",
  );
  const publicData = JSON.parse(await readFile(publicDataPath, "utf-8"));

  console.log(
    JSON.stringify(
      {
        repoRoot,
        webRepoRoot,
        generatedAtUtc,
        runs: runPlans.length,
        manifestPath,
        observedEvidencePath,
        trajectoryEvidencePath,
        longHorizonTraceRoot: options.longHorizonTraceRoot,
        longHorizonFormat: options.longHorizonFormat,
        longHorizonToolName: options.longHorizonToolName,
        minFamilyDisjointPairCount: options.minFamilyDisjointPairCount,
        publicDataPath,
        latestRunId: publicData.runs?.[publicData.runs.length - 1]?.id ?? null,
        latestScenarioCount:
          publicData.runs?.[publicData.runs.length - 1]?.scenarioCount ?? null,
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
