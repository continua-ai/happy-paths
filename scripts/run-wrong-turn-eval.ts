#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    dataset: "testdata/wrong_turn_dataset.json",
    dataDir: ".happy-paths/eval-run",
    strict: false,
    json: false,
    harness: "pi",
    scope: "personal",
    sessionPrefix: "eval-session",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--dataset") {
      options.dataset = value;
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

  const { createLocalLearningLoop, evaluateWrongTurnDataset } = await import(
    pathToFileURL(distPath).href
  );

  const datasetPath = resolve(process.cwd(), options.dataset);
  const datasetRaw = await readFile(datasetPath, "utf-8");
  const dataset = JSON.parse(datasetRaw);

  const rootDataDir = resolve(process.cwd(), options.dataDir);
  await mkdir(rootDataDir, { recursive: true });

  let loopIndex = 0;
  const evaluation = await evaluateWrongTurnDataset(
    dataset,
    () => {
      loopIndex += 1;
      return createLocalLearningLoop({
        dataDir: join(rootDataDir, `loop-${loopIndex}`),
      });
    },
    {
      harness: options.harness,
      scope: options.scope,
      sessionPrefix: options.sessionPrefix,
    },
  );

  if (options.json) {
    console.log(JSON.stringify(evaluation, null, 2));
  } else {
    const report = evaluation.report;
    console.log("Wrong-turn evaluation summary");
    console.log(`- scenarios: ${report.totalScenarios}`);
    console.log(`- hit@1: ${report.hitAt1Rate.toFixed(3)}`);
    console.log(`- hit@3: ${report.hitAt3Rate.toFixed(3)}`);
    console.log(`- mrr: ${report.meanReciprocalRank.toFixed(3)}`);
    console.log(
      `- avg suggestion latency ms: ${report.averageSuggestionLatencyMs.toFixed(2)}`,
    );
    console.log(`- total capture wall time ms: ${report.totalCaptureWallTimeMs}`);
    console.log(`- total capture cost usd: ${report.totalCaptureCostUsd.toFixed(4)}`);
    console.log(
      `- total capture token proxy: ${report.totalCaptureTokenProxy.toFixed(2)}`,
    );
    console.log(`- quality gate pass: ${evaluation.gateResult.pass}`);

    if (!evaluation.gateResult.pass) {
      console.log("- gate failures:");
      for (const failure of evaluation.gateResult.failures) {
        console.log(`  - ${failure}`);
      }
    }
  }

  if (options.strict && !evaluation.gateResult.pass) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
