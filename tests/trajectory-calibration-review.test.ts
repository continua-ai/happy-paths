import { describe, expect, it } from "vitest";
import type { TrajectoryCalibrationSampleRow } from "../src/core/trajectoryCalibration.js";
import {
  buildDualReviewPlan,
  buildReviewerPacketRows,
} from "../src/core/trajectoryCalibrationReview.js";

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
      issueKind: "unknown_failure",
      harmful: false,
      notes: "existing",
    },
    snippets: {
      command: "echo hello",
      outputFirstLine: "hello",
    },
  };
}

describe("trajectory calibration dual-review plan", () => {
  it("assigns all rows with overlap and balanced reviewer load", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(`r-${index + 1}`));

    const plan = buildDualReviewPlan(rows, {
      reviewerAId: "alice",
      reviewerBId: "bob",
      overlapRatio: 0.2,
      seed: 13,
    });

    expect(plan.totalRows).toBe(10);
    expect(plan.overlapCount).toBe(2);
    expect(plan.reviewerA.assignedCount).toBe(6);
    expect(plan.reviewerB.assignedCount).toBe(6);

    expect(plan.assignments.length).toBe(10);

    const overlapAssignments = plan.assignments.filter((assignment) => {
      return assignment.reviewers.length === 2;
    });
    expect(overlapAssignments.length).toBe(2);

    const unassigned = plan.assignments.filter((assignment) => {
      return assignment.reviewers.length === 0;
    });
    expect(unassigned.length).toBe(0);
  });

  it("builds reviewer packets and resets labels by default", () => {
    const rows = [row("r-1"), row("r-2"), row("r-3")];
    const plan = buildDualReviewPlan(rows, {
      reviewerAId: "alice",
      reviewerBId: "bob",
      overlapRatio: 0,
      seed: 2,
    });

    const packetRows = buildReviewerPacketRows(rows, plan.reviewerA.rowIds);

    expect(packetRows.length).toBe(plan.reviewerA.assignedCount);
    for (const packetRow of packetRows) {
      expect(packetRow.manualLabel.issueKind).toBeNull();
      expect(packetRow.manualLabel.harmful).toBeNull();
      expect(packetRow.manualLabel.notes).toBe("");
    }
  });

  it("can preserve existing labels in reviewer packets", () => {
    const rows = [row("r-1"), row("r-2")];

    const packetRows = buildReviewerPacketRows(rows, ["r-1"], {
      preserveExistingLabels: true,
    });

    expect(packetRows).toHaveLength(1);
    expect(packetRows[0]?.manualLabel.issueKind).toBe("unknown_failure");
    expect(packetRows[0]?.manualLabel.harmful).toBe(false);
    expect(packetRows[0]?.manualLabel.notes).toBe("existing");
  });
});
