import type { TrajectoryCalibrationSampleRow } from "./trajectoryCalibration.js";

export interface DualReviewPlanOptions {
  reviewerAId?: string;
  reviewerBId?: string;
  overlapRatio?: number;
  seed?: number;
}

export interface DualReviewRowAssignment {
  rowId: string;
  reviewers: string[];
}

export interface DualReviewReviewerSummary {
  reviewerId: string;
  assignedCount: number;
  overlapCount: number;
  rowIds: string[];
}

export interface DualReviewPlan {
  reviewerAId: string;
  reviewerBId: string;
  overlapRatio: number;
  seed: number;
  totalRows: number;
  overlapCount: number;
  reviewerA: DualReviewReviewerSummary;
  reviewerB: DualReviewReviewerSummary;
  assignments: DualReviewRowAssignment[];
}

const DEFAULT_REVIEWER_A_ID = "reviewer_a";
const DEFAULT_REVIEWER_B_ID = "reviewer_b";

function normalizeOverlapRatio(value?: number): number {
  if (!Number.isFinite(value)) {
    return 0.2;
  }
  return Math.max(0, Math.min(0.9, value ?? 0.2));
}

function normalizeSeed(value?: number): number {
  if (!Number.isFinite(value)) {
    return 31;
  }
  return Math.floor(value ?? 31);
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) {
    state = 1;
  }

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const random = createPrng(seed);
  const output = [...items];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = output[index];
    output[index] = output[swapIndex] as T;
    output[swapIndex] = current as T;
  }

  return output;
}

function uniqueRows(
  rows: TrajectoryCalibrationSampleRow[],
): Map<string, TrajectoryCalibrationSampleRow> {
  const byId = new Map<string, TrajectoryCalibrationSampleRow>();

  for (const row of rows) {
    if (byId.has(row.id)) {
      throw new Error(`duplicate calibration row id: ${row.id}`);
    }
    byId.set(row.id, row);
  }

  return byId;
}

export function buildDualReviewPlan(
  rows: TrajectoryCalibrationSampleRow[],
  options?: DualReviewPlanOptions,
): DualReviewPlan {
  const reviewerAId = options?.reviewerAId?.trim() || DEFAULT_REVIEWER_A_ID;
  const reviewerBId = options?.reviewerBId?.trim() || DEFAULT_REVIEWER_B_ID;

  if (reviewerAId === reviewerBId) {
    throw new Error("reviewer ids must be distinct for dual review");
  }

  const overlapRatio = normalizeOverlapRatio(options?.overlapRatio);
  const seed = normalizeSeed(options?.seed);

  const byId = uniqueRows(rows);
  const rowIds = [...byId.keys()].sort();
  const shuffledRowIds = shuffle(rowIds, seed);

  const totalRows = shuffledRowIds.length;
  const overlapCount = Math.max(
    0,
    Math.min(totalRows, Math.round(totalRows * overlapRatio)),
  );

  const overlapRowIds = new Set(shuffledRowIds.slice(0, overlapCount));
  const uniqueRowIds = shuffledRowIds.slice(overlapCount);

  const reviewerARowIds = new Set<string>(overlapRowIds);
  const reviewerBRowIds = new Set<string>(overlapRowIds);

  for (let index = 0; index < uniqueRowIds.length; index += 1) {
    const rowId = uniqueRowIds[index] ?? "";
    if (!rowId) {
      continue;
    }

    if (index % 2 === 0) {
      reviewerARowIds.add(rowId);
    } else {
      reviewerBRowIds.add(rowId);
    }
  }

  const assignments: DualReviewRowAssignment[] = rowIds.map((rowId) => {
    const reviewers: string[] = [];
    if (reviewerARowIds.has(rowId)) {
      reviewers.push(reviewerAId);
    }
    if (reviewerBRowIds.has(rowId)) {
      reviewers.push(reviewerBId);
    }

    if (reviewers.length === 0) {
      throw new Error(`row left unassigned: ${rowId}`);
    }

    return {
      rowId,
      reviewers,
    };
  });

  const orderedReviewerAIds = assignments
    .filter((assignment) => assignment.reviewers.includes(reviewerAId))
    .map((assignment) => assignment.rowId);

  const orderedReviewerBIds = assignments
    .filter((assignment) => assignment.reviewers.includes(reviewerBId))
    .map((assignment) => assignment.rowId);

  return {
    reviewerAId,
    reviewerBId,
    overlapRatio,
    seed,
    totalRows,
    overlapCount,
    reviewerA: {
      reviewerId: reviewerAId,
      assignedCount: orderedReviewerAIds.length,
      overlapCount,
      rowIds: orderedReviewerAIds,
    },
    reviewerB: {
      reviewerId: reviewerBId,
      assignedCount: orderedReviewerBIds.length,
      overlapCount,
      rowIds: orderedReviewerBIds,
    },
    assignments,
  };
}

function cloneRowForReview(
  row: TrajectoryCalibrationSampleRow,
  preserveExistingLabels: boolean,
): TrajectoryCalibrationSampleRow {
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
    manualLabel: preserveExistingLabels
      ? {
          ...row.manualLabel,
        }
      : {
          issueKind: null,
          harmful: null,
          notes: "",
        },
  };
}

export function buildReviewerPacketRows(
  rows: TrajectoryCalibrationSampleRow[],
  rowIds: string[],
  options?: {
    preserveExistingLabels?: boolean;
  },
): TrajectoryCalibrationSampleRow[] {
  const byId = uniqueRows(rows);
  const preserveExistingLabels = options?.preserveExistingLabels === true;

  const packetRows: TrajectoryCalibrationSampleRow[] = [];
  for (const rowId of rowIds) {
    const row = byId.get(rowId);
    if (!row) {
      throw new Error(`unknown row id requested for packet: ${rowId}`);
    }
    packetRows.push(cloneRowForReview(row, preserveExistingLabels));
  }

  return packetRows;
}
