import type {
  TrajectoryCalibrationManualLabel,
  TrajectoryCalibrationSampleRow,
} from "./trajectoryCalibration.js";

export type TrajectoryCalibrationConflictPolicy =
  | "unresolved"
  | "reviewer_a"
  | "reviewer_b"
  | "predicted";

export interface TrajectoryCalibrationAdjudicationOptions {
  reviewerAId?: string;
  reviewerBId?: string;
  conflictPolicy?: TrajectoryCalibrationConflictPolicy;
}

export interface TrajectoryCalibrationConflict {
  rowId: string;
  reviewerAIssueKind: string;
  reviewerAHarmful: boolean;
  reviewerANotes: string;
  reviewerBIssueKind: string;
  reviewerBHarmful: boolean;
  reviewerBNotes: string;
  predictedIssueKind: string;
  predictedHarmful: boolean;
}

export interface TrajectoryCalibrationAdjudicationStats {
  totalRows: number;
  labeledByReviewerA: number;
  labeledByReviewerB: number;
  labeledByAnyReviewer: number;
  labeledByBothReviewers: number;
  agreedByBothReviewers: number;
  conflicts: number;
  unresolvedConflicts: number;
  adjudicatedRows: number;
  remainingUnlabeledRows: number;
  labelCoverage: number;
}

export interface TrajectoryCalibrationAdjudicationResult {
  reviewerAId: string;
  reviewerBId: string;
  conflictPolicy: TrajectoryCalibrationConflictPolicy;
  stats: TrajectoryCalibrationAdjudicationStats;
  conflicts: TrajectoryCalibrationConflict[];
  rows: TrajectoryCalibrationSampleRow[];
}

const DEFAULT_REVIEWER_A_ID = "reviewer_a";
const DEFAULT_REVIEWER_B_ID = "reviewer_b";

function isFullyLabeled(
  manualLabel: TrajectoryCalibrationManualLabel | undefined,
): manualLabel is {
  issueKind: NonNullable<TrajectoryCalibrationManualLabel["issueKind"]>;
  harmful: NonNullable<TrajectoryCalibrationManualLabel["harmful"]>;
  notes?: string;
} {
  if (!manualLabel) {
    return false;
  }

  return manualLabel.issueKind !== null && manualLabel.harmful !== null;
}

function normalizeRows(
  rows: TrajectoryCalibrationSampleRow[],
): Map<string, TrajectoryCalibrationSampleRow> {
  const byId = new Map<string, TrajectoryCalibrationSampleRow>();

  for (const row of rows) {
    if (!row.id) {
      continue;
    }

    if (byId.has(row.id)) {
      throw new Error(`duplicate calibration row id: ${row.id}`);
    }

    byId.set(row.id, row);
  }

  return byId;
}

function cloneRow(row: TrajectoryCalibrationSampleRow): TrajectoryCalibrationSampleRow {
  return {
    ...row,
    predicted: {
      ...row.predicted,
    },
    snippets: row.snippets
      ? {
          ...row.snippets,
        }
      : undefined,
    manualLabel: {
      ...row.manualLabel,
    },
  };
}

function chooseConflictLabel(
  row: TrajectoryCalibrationSampleRow,
  reviewerALabel: {
    issueKind: NonNullable<TrajectoryCalibrationManualLabel["issueKind"]>;
    harmful: NonNullable<TrajectoryCalibrationManualLabel["harmful"]>;
    notes?: string;
  },
  reviewerBLabel: {
    issueKind: NonNullable<TrajectoryCalibrationManualLabel["issueKind"]>;
    harmful: NonNullable<TrajectoryCalibrationManualLabel["harmful"]>;
    notes?: string;
  },
  policy: TrajectoryCalibrationConflictPolicy,
): TrajectoryCalibrationManualLabel | null {
  if (policy === "reviewer_a") {
    return {
      issueKind: reviewerALabel.issueKind,
      harmful: reviewerALabel.harmful,
      notes: reviewerALabel.notes ?? "",
    };
  }

  if (policy === "reviewer_b") {
    return {
      issueKind: reviewerBLabel.issueKind,
      harmful: reviewerBLabel.harmful,
      notes: reviewerBLabel.notes ?? "",
    };
  }

  if (policy === "predicted") {
    return {
      issueKind: row.predicted.issueKind,
      harmful: row.predicted.harmful,
      notes: row.predicted.reason
        ? `predicted fallback: ${row.predicted.reason}`
        : "predicted fallback",
    };
  }

  return null;
}

export function adjudicateTrajectoryCalibrationRows(
  rows: TrajectoryCalibrationSampleRow[],
  reviewerARows: TrajectoryCalibrationSampleRow[],
  reviewerBRows: TrajectoryCalibrationSampleRow[],
  options?: TrajectoryCalibrationAdjudicationOptions,
): TrajectoryCalibrationAdjudicationResult {
  const reviewerAId = options?.reviewerAId?.trim() || DEFAULT_REVIEWER_A_ID;
  const reviewerBId = options?.reviewerBId?.trim() || DEFAULT_REVIEWER_B_ID;
  const conflictPolicy = options?.conflictPolicy ?? "unresolved";

  const baseRowsById = normalizeRows(rows);
  const reviewerAById = normalizeRows(reviewerARows);
  const reviewerBById = normalizeRows(reviewerBRows);

  let labeledByReviewerA = 0;
  let labeledByReviewerB = 0;
  let labeledByAnyReviewer = 0;
  let labeledByBothReviewers = 0;
  let agreedByBothReviewers = 0;
  let unresolvedConflicts = 0;
  let adjudicatedRows = 0;

  const conflicts: TrajectoryCalibrationConflict[] = [];
  const outputRows: TrajectoryCalibrationSampleRow[] = [];

  for (const [rowId, baseRow] of [...baseRowsById.entries()].sort((left, right) => {
    return left[0] < right[0] ? -1 : 1;
  })) {
    const row = cloneRow(baseRow);

    const reviewerALabel = reviewerAById.get(rowId)?.manualLabel;
    const reviewerBLabel = reviewerBById.get(rowId)?.manualLabel;

    const reviewerAComplete = isFullyLabeled(reviewerALabel);
    const reviewerBComplete = isFullyLabeled(reviewerBLabel);

    if (reviewerAComplete) {
      labeledByReviewerA += 1;
    }
    if (reviewerBComplete) {
      labeledByReviewerB += 1;
    }

    if (reviewerAComplete || reviewerBComplete) {
      labeledByAnyReviewer += 1;
    }

    if (reviewerAComplete && reviewerBComplete) {
      labeledByBothReviewers += 1;
    }

    if (reviewerAComplete && reviewerBComplete) {
      const agrees =
        reviewerALabel.issueKind === reviewerBLabel.issueKind &&
        reviewerALabel.harmful === reviewerBLabel.harmful;

      if (agrees) {
        agreedByBothReviewers += 1;
        row.manualLabel = {
          issueKind: reviewerALabel.issueKind,
          harmful: reviewerALabel.harmful,
          notes: reviewerALabel.notes ?? reviewerBLabel.notes ?? "",
        };
        adjudicatedRows += 1;
        outputRows.push(row);
        continue;
      }

      conflicts.push({
        rowId,
        reviewerAIssueKind: reviewerALabel.issueKind,
        reviewerAHarmful: reviewerALabel.harmful,
        reviewerANotes: reviewerALabel.notes ?? "",
        reviewerBIssueKind: reviewerBLabel.issueKind,
        reviewerBHarmful: reviewerBLabel.harmful,
        reviewerBNotes: reviewerBLabel.notes ?? "",
        predictedIssueKind: row.predicted.issueKind,
        predictedHarmful: row.predicted.harmful,
      });

      const fallbackLabel = chooseConflictLabel(
        row,
        reviewerALabel,
        reviewerBLabel,
        conflictPolicy,
      );

      if (fallbackLabel) {
        row.manualLabel = fallbackLabel;
        adjudicatedRows += 1;
      } else {
        unresolvedConflicts += 1;
        row.manualLabel = {
          issueKind: null,
          harmful: null,
          notes: "",
        };
      }

      outputRows.push(row);
      continue;
    }

    if (reviewerAComplete) {
      row.manualLabel = {
        issueKind: reviewerALabel.issueKind,
        harmful: reviewerALabel.harmful,
        notes: reviewerALabel.notes ?? "",
      };
      adjudicatedRows += 1;
      outputRows.push(row);
      continue;
    }

    if (reviewerBComplete) {
      row.manualLabel = {
        issueKind: reviewerBLabel.issueKind,
        harmful: reviewerBLabel.harmful,
        notes: reviewerBLabel.notes ?? "",
      };
      adjudicatedRows += 1;
      outputRows.push(row);
      continue;
    }

    row.manualLabel = {
      issueKind: null,
      harmful: null,
      notes: "",
    };
    outputRows.push(row);
  }

  const stats: TrajectoryCalibrationAdjudicationStats = {
    totalRows: outputRows.length,
    labeledByReviewerA,
    labeledByReviewerB,
    labeledByAnyReviewer,
    labeledByBothReviewers,
    agreedByBothReviewers,
    conflicts: conflicts.length,
    unresolvedConflicts,
    adjudicatedRows,
    remainingUnlabeledRows: outputRows.length - adjudicatedRows,
    labelCoverage: outputRows.length > 0 ? adjudicatedRows / outputRows.length : 0,
  };

  return {
    reviewerAId,
    reviewerBId,
    conflictPolicy,
    stats,
    conflicts,
    rows: outputRows,
  };
}
