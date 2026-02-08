import { describe, expect, it } from "vitest";
import type { TrajectoryCalibrationSampleRow } from "../src/core/trajectoryCalibration.js";
import { adjudicateTrajectoryCalibrationRows } from "../src/core/trajectoryCalibrationAdjudication.js";

function row(id: string): TrajectoryCalibrationSampleRow {
  return {
    id,
    episodeId: `${id}-episode`,
    familySignature: `${id}-family`,
    sessionId: `${id}-session`,
    startedAt: "2026-02-01T00:00:00Z",
    predicted: {
      issueKind: "unknown_failure",
      harmful: false,
      confidence: 0.35,
      abstained: true,
      reason: "seed",
    },
    manualLabel: {
      issueKind: null,
      harmful: null,
      notes: "",
    },
    snippets: {
      command: "echo hello",
      outputFirstLine: "hello",
    },
  };
}

function withLabel(
  input: TrajectoryCalibrationSampleRow,
  label: {
    issueKind: NonNullable<TrajectoryCalibrationSampleRow["manualLabel"]["issueKind"]>;
    harmful: NonNullable<TrajectoryCalibrationSampleRow["manualLabel"]["harmful"]>;
    notes?: string;
  },
): TrajectoryCalibrationSampleRow {
  return {
    ...input,
    manualLabel: {
      issueKind: label.issueKind,
      harmful: label.harmful,
      notes: label.notes ?? "",
    },
  };
}

describe("trajectory calibration adjudication", () => {
  it("tracks unresolved conflicts when policy is unresolved", () => {
    const baseRows = [row("r1"), row("r2"), row("r3"), row("r4")];

    const reviewerARows = [
      withLabel(row("r1"), {
        issueKind: "command_mismatch",
        harmful: true,
      }),
      withLabel(row("r2"), {
        issueKind: "unknown_failure",
        harmful: false,
      }),
    ];

    const reviewerBRows = [
      withLabel(row("r1"), {
        issueKind: "command_mismatch",
        harmful: true,
      }),
      withLabel(row("r2"), {
        issueKind: "missing_context",
        harmful: true,
      }),
      withLabel(row("r3"), {
        issueKind: "transient_external",
        harmful: false,
      }),
    ];

    const result = adjudicateTrajectoryCalibrationRows(
      baseRows,
      reviewerARows,
      reviewerBRows,
      {
        reviewerAId: "alice",
        reviewerBId: "bob",
        conflictPolicy: "unresolved",
      },
    );

    expect(result.stats.totalRows).toBe(4);
    expect(result.stats.labeledByReviewerA).toBe(2);
    expect(result.stats.labeledByReviewerB).toBe(3);
    expect(result.stats.labeledByAnyReviewer).toBe(3);
    expect(result.stats.labeledByBothReviewers).toBe(2);
    expect(result.stats.agreedByBothReviewers).toBe(1);
    expect(result.stats.conflicts).toBe(1);
    expect(result.stats.unresolvedConflicts).toBe(1);
    expect(result.stats.adjudicatedRows).toBe(2);
    expect(result.stats.remainingUnlabeledRows).toBe(2);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.rowId).toBe("r2");

    const row2 = result.rows.find((item) => item.id === "r2");
    expect(row2?.manualLabel.issueKind).toBeNull();
    expect(row2?.manualLabel.harmful).toBeNull();
  });

  it("can resolve conflicts with reviewer-a policy", () => {
    const baseRows = [row("r1"), row("r2"), row("r3")];

    const reviewerARows = [
      withLabel(row("r1"), {
        issueKind: "command_mismatch",
        harmful: true,
      }),
      withLabel(row("r2"), {
        issueKind: "unknown_failure",
        harmful: false,
      }),
    ];

    const reviewerBRows = [
      withLabel(row("r1"), {
        issueKind: "command_mismatch",
        harmful: true,
      }),
      withLabel(row("r2"), {
        issueKind: "missing_context",
        harmful: true,
      }),
      withLabel(row("r3"), {
        issueKind: "transient_external",
        harmful: false,
      }),
    ];

    const result = adjudicateTrajectoryCalibrationRows(
      baseRows,
      reviewerARows,
      reviewerBRows,
      {
        reviewerAId: "alice",
        reviewerBId: "bob",
        conflictPolicy: "reviewer_a",
      },
    );

    expect(result.stats.conflicts).toBe(1);
    expect(result.stats.unresolvedConflicts).toBe(0);
    expect(result.stats.adjudicatedRows).toBe(3);
    expect(result.stats.remainingUnlabeledRows).toBe(0);

    const row2 = result.rows.find((item) => item.id === "r2");
    expect(row2?.manualLabel.issueKind).toBe("unknown_failure");
    expect(row2?.manualLabel.harmful).toBe(false);
  });
});
