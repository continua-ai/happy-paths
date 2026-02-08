import { describe, expect, it } from "vitest";
import {
  type TrajectoryCalibrationSampleRow,
  summarizeTrajectoryCalibration,
} from "../src/core/trajectoryCalibration.js";

function row(
  input: Partial<TrajectoryCalibrationSampleRow> & {
    predicted: TrajectoryCalibrationSampleRow["predicted"];
    manualLabel: TrajectoryCalibrationSampleRow["manualLabel"];
  },
): TrajectoryCalibrationSampleRow {
  return {
    id: input.id ?? "row-id",
    episodeId: input.episodeId ?? "episode-1",
    familySignature: input.familySignature ?? "sig",
    sessionId: input.sessionId ?? "session-1",
    startedAt: input.startedAt ?? "2026-02-01T00:00:00Z",
    predicted: input.predicted,
    manualLabel: input.manualLabel,
    snippets: input.snippets,
  };
}

describe("trajectory calibration summary", () => {
  it("computes issue-kind confusion and harmful metrics", () => {
    const rows: TrajectoryCalibrationSampleRow[] = [
      row({
        id: "r1",
        predicted: {
          issueKind: "command_mismatch",
          harmful: true,
          confidence: 0.9,
          abstained: false,
        },
        manualLabel: {
          issueKind: "command_mismatch",
          harmful: true,
        },
      }),
      row({
        id: "r2",
        predicted: {
          issueKind: "unknown_failure",
          harmful: false,
          confidence: 0.4,
          abstained: true,
        },
        manualLabel: {
          issueKind: "environment_mismatch",
          harmful: true,
        },
      }),
      row({
        id: "r3",
        predicted: {
          issueKind: "transient_external",
          harmful: false,
          confidence: 0.8,
          abstained: false,
        },
        manualLabel: {
          issueKind: "transient_external",
          harmful: false,
        },
      }),
      row({
        id: "r4",
        predicted: {
          issueKind: "environment_mismatch",
          harmful: true,
          confidence: 0.7,
          abstained: false,
        },
        manualLabel: {
          issueKind: "command_mismatch",
          harmful: true,
        },
      }),
      row({
        id: "r5",
        predicted: {
          issueKind: "benign_probe",
          harmful: false,
          confidence: 0.6,
          abstained: false,
        },
        manualLabel: {
          issueKind: null,
          harmful: null,
        },
      }),
    ];

    const summary = summarizeTrajectoryCalibration(rows);

    expect(summary.totalRows).toBe(5);
    expect(summary.fullyLabeledRows).toBe(4);
    expect(summary.unlabeledRows).toBe(1);
    expect(summary.partiallyLabeledRows).toBe(0);
    expect(summary.labelCoverage).toBeCloseTo(0.8, 6);

    expect(summary.issueKindAccuracy).toBeCloseTo(0.5, 6);
    expect(summary.issueKindConfusionMatrix.command_mismatch.command_mismatch).toBe(1);
    expect(summary.issueKindConfusionMatrix.unknown_failure.environment_mismatch).toBe(
      1,
    );

    expect(summary.harmfulMetrics.truePositive).toBe(2);
    expect(summary.harmfulMetrics.falsePositive).toBe(0);
    expect(summary.harmfulMetrics.falseNegative).toBe(1);
    expect(summary.harmfulMetrics.trueNegative).toBe(1);
    expect(summary.harmfulMetrics.precision).toBeCloseTo(1, 6);
    expect(summary.harmfulMetrics.recall).toBeCloseTo(2 / 3, 6);
    expect(summary.harmfulMetrics.f1).toBeCloseTo(0.8, 6);

    expect(summary.abstain.predictedAbstainCount).toBe(1);
    expect(summary.abstain.predictedAbstainRate).toBeCloseTo(0.25, 6);
    expect(summary.abstain.judgeableCoverage).toBeCloseTo(0.75, 6);
    expect(summary.abstain.abstainedHarmfulCount).toBe(1);
    expect(summary.abstain.abstainedHarmfulRate).toBeCloseTo(1 / 3, 6);
  });

  it("handles fully unlabeled input without NaN metrics", () => {
    const rows: TrajectoryCalibrationSampleRow[] = [
      row({
        predicted: {
          issueKind: "unknown_failure",
          harmful: false,
          confidence: 0.2,
          abstained: true,
        },
        manualLabel: {
          issueKind: null,
          harmful: null,
        },
      }),
    ];

    const summary = summarizeTrajectoryCalibration(rows);

    expect(summary.fullyLabeledRows).toBe(0);
    expect(summary.labelCoverage).toBe(0);
    expect(summary.issueKindAccuracy).toBe(0);
    expect(summary.harmfulMetrics.f1).toBe(0);
    expect(summary.abstain.predictedAbstainRate).toBe(0);
    expect(summary.abstain.judgeableCoverage).toBe(0);
  });
});
