#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseFloatOrUndefined(value) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid number: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    dataset: "testdata/wrong_turn_dataset.json",
    additionalDatasets: [],
    dataDir: ".happy-paths/feasibility-memo",
    harness: "pi",
    scope: "personal",
    sessionPrefix: "feasibility-memo",
    out: "docs/feasibility-decision.md",
    thresholds: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--dataset") {
      options.dataset = value;
      index += 1;
      continue;
    }
    if (token === "--additional-dataset") {
      options.additionalDatasets.push(value);
      index += 1;
      continue;
    }
    if (token === "--data-dir") {
      options.dataDir = value;
      index += 1;
      continue;
    }
    if (token === "--harness") {
      options.harness = value;
      index += 1;
      continue;
    }
    if (token === "--scope") {
      options.scope = value;
      index += 1;
      continue;
    }
    if (token === "--session-prefix") {
      options.sessionPrefix = value;
      index += 1;
      continue;
    }
    if (token === "--out") {
      options.out = value;
      index += 1;
      continue;
    }
    if (token === "--min-relative-dead-end-reduction") {
      options.thresholds.minRelativeDeadEndRateReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-wall-time-reduction") {
      options.thresholds.minRelativeWallTimeReduction = parseFloatOrUndefined(value);
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
    }
  }

  return options;
}

function markdownForMemo(report, memo) {
  const lines = [];
  lines.push("# Feasibility decision memo");
  lines.push("");
  lines.push(`- Decision: **${memo.decision.toUpperCase()}**`);
  lines.push(`- Summary: ${memo.summary}`);
  lines.push("");

  lines.push("## OFF vs ON retrieval");
  lines.push("");
  lines.push(`- OFF hit@1: ${report.retrievalOff.hitAt1Rate.toFixed(3)}`);
  lines.push(`- OFF hit@3: ${report.retrievalOff.hitAt3Rate.toFixed(3)}`);
  lines.push(`- OFF MRR: ${report.retrievalOff.meanReciprocalRank.toFixed(3)}`);
  lines.push(`- ON hit@1: ${report.retrievalOn.hitAt1Rate.toFixed(3)}`);
  lines.push(`- ON hit@3: ${report.retrievalOn.hitAt3Rate.toFixed(3)}`);
  lines.push(`- ON MRR: ${report.retrievalOn.meanReciprocalRank.toFixed(3)}`);
  lines.push("");

  lines.push("## Feasibility deltas");
  lines.push("");
  lines.push(
    `- Repeated dead-end rate: ${report.aggregate.repeatedDeadEndRateOff.toFixed(3)} -> ${report.aggregate.repeatedDeadEndRateOn.toFixed(3)} (relative reduction ${report.aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3)})`,
  );
  lines.push(
    `- Wall time proxy (ms): ${report.aggregate.totalWallTimeOffMs.toFixed(1)} -> ${report.aggregate.totalWallTimeOnMs.toFixed(1)} (relative reduction ${report.aggregate.relativeWallTimeReduction.toFixed(3)})`,
  );
  lines.push(
    `- Token proxy: ${report.aggregate.totalTokenProxyOff.toFixed(1)} -> ${report.aggregate.totalTokenProxyOn.toFixed(1)} (relative reduction ${report.aggregate.relativeTokenProxyReduction.toFixed(3)})`,
  );
  lines.push(
    `- Recovery success rate: ${report.aggregate.recoverySuccessRateOff.toFixed(3)} -> ${report.aggregate.recoverySuccessRateOn.toFixed(3)} (delta ${report.aggregate.absoluteRecoverySuccessRateDelta.toFixed(3)})`,
  );
  lines.push("");

  lines.push("## Threshold checks");
  lines.push("");
  lines.push(`- Gate pass: ${report.gateResult.pass}`);
  if (!report.gateResult.pass) {
    for (const failure of report.gateResult.failures) {
      lines.push(`- Failure: ${failure}`);
    }
  }
  lines.push("");

  lines.push("## Top risks");
  lines.push("");
  if (memo.topRisks.length === 0) {
    lines.push("- None flagged by current heuristic checks.");
  } else {
    for (const risk of memo.topRisks) {
      lines.push(`- **${risk.title}**: ${risk.detail}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const {
    buildFeasibilityDecisionMemo,
    buildScenarioBatchFromDataset,
    createLocalLearningLoop,
    defaultFeasibilityThresholds,
    evaluateFeasibilityGate,
  } = await import(pathToFileURL(resolve(process.cwd(), "dist/index.js")).href);

  const datasetPaths = [options.dataset, ...options.additionalDatasets].map((path) => {
    return resolve(process.cwd(), path);
  });

  const scenarios = [];
  for (const [index, datasetPath] of datasetPaths.entries()) {
    const raw = await readFile(datasetPath, "utf-8");
    const dataset = JSON.parse(raw);
    const batch = buildScenarioBatchFromDataset(dataset, {
      harness: options.harness,
      scope: options.scope,
      sessionPrefix: `${options.sessionPrefix}-${index + 1}`,
    });
    scenarios.push(...batch);
  }

  if (scenarios.length === 0) {
    throw new Error("No scenarios available for memo.");
  }

  const rootDataDir = resolve(process.cwd(), options.dataDir);
  await mkdir(rootDataDir, { recursive: true });

  let loopIndex = 0;
  const thresholds = {
    ...defaultFeasibilityThresholds(),
    ...options.thresholds,
  };

  const report = await evaluateFeasibilityGate(
    scenarios,
    () => {
      loopIndex += 1;
      return createLocalLearningLoop({
        dataDir: join(rootDataDir, `loop-${loopIndex}`),
      });
    },
    thresholds,
  );

  const memo = buildFeasibilityDecisionMemo(report);
  const markdown = markdownForMemo(report, memo);

  const outPath = resolve(process.cwd(), options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, "utf-8");

  console.log(
    JSON.stringify(
      {
        out: outPath,
        decision: memo.decision,
        scenarioCount: report.aggregate.totalScenarios,
        gatePass: report.gateResult.pass,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
