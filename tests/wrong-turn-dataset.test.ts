import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalLearningLoop } from "../src/backends/local/index.js";
import {
  type WrongTurnDataset,
  buildScenarioBatchFromDataset,
  evaluateWrongTurnDataset,
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

describe("wrong-turn dataset", () => {
  it("builds scenario batches with deterministic IDs", async () => {
    const dataset = await readDatasetFixture();

    const scenarios = buildScenarioBatchFromDataset(dataset, {
      harness: "pi",
      scope: "team",
      sessionPrefix: "batch",
      startTime: new Date("2026-03-01T00:00:00.000Z"),
      scenarioTimeStepMs: 500,
    });

    expect(scenarios.length).toBe(2);
    expect(scenarios[0]?.captureEvents[0]?.sessionId).toBe("batch-1");
    expect(scenarios[1]?.captureEvents[0]?.sessionId).toBe("batch-2");
    expect(scenarios[0]?.captureEvents[0]?.scope).toBe("team");
    expect(scenarios[0]?.captureEvents[0]?.harness).toBe("pi");
  });

  it("evaluates dataset and applies configured quality gate", async () => {
    const dataset = await readDatasetFixture();

    const root = await mkdtemp(join(tmpdir(), "contilore-dataset-"));
    tempDirs.push(root);

    let index = 0;
    const evaluation = await evaluateWrongTurnDataset(dataset, () => {
      index += 1;
      return createLocalLearningLoop({
        dataDir: join(root, `loop-${index}`),
      });
    });

    expect(evaluation.report.totalScenarios).toBe(2);
    expect(evaluation.report.hitAt3Rate).toBe(1);
    expect(evaluation.report.hitAt1Rate).toBeGreaterThanOrEqual(0);
    expect(evaluation.report.meanReciprocalRank).toBeGreaterThanOrEqual(0.3);
    expect(evaluation.gateResult.pass).toBe(true);
    expect(evaluation.gateResult.failures).toEqual([]);
  });
});
