#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
    dataDir: ".happy-paths/feasibility-run",
    strict: false,
    json: false,
    harness: "pi",
    scope: "personal",
    sessionPrefix: "feasibility-session",
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const distPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(distPath)) {
    console.error("dist/index.js not found. Run `npm run build` first.");
    process.exitCode = 1;
    return;
  }

  const {
    buildScenarioBatchFromDataset,
    createLocalLearningLoop,
    defaultFeasibilityThresholds,
    evaluateFeasibilityGate,
  } = await import(pathToFileURL(distPath).href);

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
    console.error("No scenarios found for feasibility evaluation.");
    process.exitCode = 1;
    return;
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

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Feasibility gate summary");
    console.log(`- scenarios: ${report.aggregate.totalScenarios}`);

    console.log("- retrieval off:");
    console.log(`  - hit@1: ${report.retrievalOff.hitAt1Rate.toFixed(3)}`);
    console.log(`  - hit@3: ${report.retrievalOff.hitAt3Rate.toFixed(3)}`);
    console.log(`  - mrr: ${report.retrievalOff.meanReciprocalRank.toFixed(3)}`);

    console.log("- retrieval on:");
    console.log(`  - hit@1: ${report.retrievalOn.hitAt1Rate.toFixed(3)}`);
    console.log(`  - hit@3: ${report.retrievalOn.hitAt3Rate.toFixed(3)}`);
    console.log(`  - mrr: ${report.retrievalOn.meanReciprocalRank.toFixed(3)}`);

    console.log("- feasibility deltas:");
    console.log(
      [
        "  - repeated dead-end rate:",
        `${report.aggregate.repeatedDeadEndRateOff.toFixed(3)} ->`,
        report.aggregate.repeatedDeadEndRateOn.toFixed(3),
        `(relative reduction ${report.aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3)})`,
      ].join(" "),
    );
    console.log(
      [
        "  - wall time ms:",
        `${report.aggregate.totalWallTimeOffMs.toFixed(1)} ->`,
        report.aggregate.totalWallTimeOnMs.toFixed(1),
        `(relative reduction ${report.aggregate.relativeWallTimeReduction.toFixed(3)})`,
      ].join(" "),
    );
    console.log(
      [
        "  - token proxy:",
        `${report.aggregate.totalTokenProxyOff.toFixed(1)} ->`,
        report.aggregate.totalTokenProxyOn.toFixed(1),
        `(relative reduction ${report.aggregate.relativeTokenProxyReduction.toFixed(3)})`,
      ].join(" "),
    );
    console.log(
      [
        "  - recovery success rate:",
        `${report.aggregate.recoverySuccessRateOff.toFixed(3)} ->`,
        report.aggregate.recoverySuccessRateOn.toFixed(3),
        `(delta ${report.aggregate.absoluteRecoverySuccessRateDelta.toFixed(3)})`,
      ].join(" "),
    );

    console.log(`- gate pass: ${report.gateResult.pass}`);
    if (!report.gateResult.pass) {
      console.log("- gate failures:");
      for (const failure of report.gateResult.failures) {
        console.log(`  - ${failure}`);
      }
    }
  }

  if (options.strict && !report.gateResult.pass) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
