import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalLearningLoop } from "../src/backends/local/index.js";
import {
  type FeasibilityThresholds,
  buildFeasibilityDecisionMemo,
  evaluateFeasibilityGate,
  summarizeFeasibilityTrust,
} from "../src/core/feasibilityGate.js";
import {
  type WrongTurnDataset,
  buildScenarioBatchFromDataset,
} from "../src/core/wrongTurnDataset.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const path = tempDirs.pop();
    if (!path) {
      continue;
    }
    await rm(path, { recursive: true, force: true });
  }
});

async function readDatasetFixture(): Promise<WrongTurnDataset> {
  const thisFile = fileURLToPath(import.meta.url);
  const fixturePath = join(
    dirname(thisFile),
    "..",
    "testdata",
    "wrong_turn_dataset.json",
  );
  const raw = await readFile(fixturePath, "utf-8");
  return JSON.parse(raw) as WrongTurnDataset;
}

describe("feasibility gate", () => {
  it("compares OFF vs ON retrieval and passes default gate on fixture", async () => {
    const dataset = await readDatasetFixture();
    const scenarios = buildScenarioBatchFromDataset(dataset, {
      harness: "pi",
      scope: "personal",
      sessionPrefix: "feasibility",
    });

    const root = await mkdtemp(join(tmpdir(), "happy-paths-feasibility-"));
    tempDirs.push(root);

    let loopIndex = 0;
    const report = await evaluateFeasibilityGate(scenarios, () => {
      loopIndex += 1;
      return createLocalLearningLoop({
        dataDir: join(root, `loop-${loopIndex}`),
      });
    });

    expect(report.aggregate.totalScenarios).toBe(2);
    expect(report.retrievalOn.hitAt3Rate).toBeGreaterThanOrEqual(
      report.retrievalOff.hitAt3Rate,
    );
    expect(report.aggregate.relativeRepeatedDeadEndRateReduction).toBeGreaterThan(0);
    expect(report.gateResult.pass).toBe(true);

    expect(report.trustSummary.method).toBe("paired_bootstrap");
    expect(report.trustSummary.sampleCount).toBeGreaterThanOrEqual(200);
    expect(report.trustSummary.deadEndReduction.high).toBeGreaterThanOrEqual(
      report.trustSummary.deadEndReduction.low,
    );
    expect(report.trustSummary.expectedRepeatedDeadEndsAvoided.median).toBeGreaterThan(
      0,
    );

    const memo = buildFeasibilityDecisionMemo(report);
    expect(memo.decision).toBe("go");
    expect(memo.topRisks.length).toBeGreaterThan(0);
  });

  it("fails the gate with overly strict thresholds", async () => {
    const dataset = await readDatasetFixture();
    const scenarios = buildScenarioBatchFromDataset(dataset, {
      harness: "pi",
      scope: "personal",
      sessionPrefix: "strict-feasibility",
    });

    const root = await mkdtemp(join(tmpdir(), "happy-paths-feasibility-strict-"));
    tempDirs.push(root);

    let loopIndex = 0;
    const strict: FeasibilityThresholds = {
      minRelativeDeadEndRateReduction: 1,
      minRelativeWallTimeReduction: 1,
      minRelativeTokenProxyReduction: 1,
      minRecoverySuccessRateOn: 1,
      maxRecoverySuccessRateDrop: -0.001,
    };

    const report = await evaluateFeasibilityGate(
      scenarios,
      () => {
        loopIndex += 1;
        return createLocalLearningLoop({
          dataDir: join(root, `strict-loop-${loopIndex}`),
        });
      },
      strict,
    );

    expect(report.gateResult.pass).toBe(false);
    expect(report.gateResult.failures.length).toBeGreaterThan(0);
  });

  it("produces deterministic trust summary with fixed options", async () => {
    const dataset = await readDatasetFixture();
    const scenarios = buildScenarioBatchFromDataset(dataset, {
      harness: "pi",
      scope: "personal",
      sessionPrefix: "trust-summary",
    });

    const root = await mkdtemp(join(tmpdir(), "happy-paths-feasibility-trust-"));
    tempDirs.push(root);

    let loopIndex = 0;
    const report = await evaluateFeasibilityGate(
      scenarios,
      () => {
        loopIndex += 1;
        return createLocalLearningLoop({
          dataDir: join(root, `trust-loop-${loopIndex}`),
        });
      },
      undefined,
      {
        bootstrapSamples: 300,
        confidenceLevel: 0.9,
        seed: 42,
      },
    );

    const summaryA = summarizeFeasibilityTrust(report.scenarioEstimates, {
      bootstrapSamples: 300,
      confidenceLevel: 0.9,
      seed: 42,
    });
    const summaryB = summarizeFeasibilityTrust(report.scenarioEstimates, {
      bootstrapSamples: 300,
      confidenceLevel: 0.9,
      seed: 42,
    });

    expect(summaryA).toEqual(summaryB);
    expect(summaryA.deadEndReduction.low).toBeGreaterThanOrEqual(0);
    expect(summaryA.deadEndReduction.high).toBeLessThanOrEqual(1);
    expect(summaryA.expectedRepeatedDeadEndsAvoided.median).toBeGreaterThan(0);
  });
});
