import type { TrajectoryIssueKind } from "./trajectoryOutcomeGate.js";

export const TRAJECTORY_CALIBRATION_ISSUE_KINDS: TrajectoryIssueKind[] = [
  "benign_probe",
  "transient_external",
  "command_mismatch",
  "environment_mismatch",
  "missing_context",
  "unknown_failure",
];

export type TrajectoryIssueKindCountMap = Record<TrajectoryIssueKind, number>;

export type TrajectoryIssueKindConfusionMatrix = Record<
  TrajectoryIssueKind,
  TrajectoryIssueKindCountMap
>;

export interface TrajectoryCalibrationPredictedLabel {
  issueKind: TrajectoryIssueKind;
  harmful: boolean;
  confidence: number;
  abstained: boolean;
  reason?: string;
}

export interface TrajectoryCalibrationManualLabel {
  issueKind: TrajectoryIssueKind | null;
  harmful: boolean | null;
  notes?: string;
}

export interface TrajectoryCalibrationSampleRow {
  id: string;
  episodeId: string;
  familySignature: string;
  sessionId: string;
  startedAt: string;
  predicted: TrajectoryCalibrationPredictedLabel;
  manualLabel: TrajectoryCalibrationManualLabel;
  snippets?: {
    command?: string;
    outputFirstLine?: string;
  };
}

export interface TrajectoryCalibrationIssueKindMetrics {
  issueKind: TrajectoryIssueKind;
  support: number;
  predicted: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface TrajectoryCalibrationHarmfulMetrics {
  supportPositive: number;
  supportNegative: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
}

export interface TrajectoryCalibrationAbstainSummary {
  predictedAbstainCount: number;
  predictedAbstainRate: number;
  judgeableCoverage: number;
  abstainedHarmfulCount: number;
  abstainedHarmfulRate: number;
}

export interface TrajectoryCalibrationSummary {
  totalRows: number;
  fullyLabeledRows: number;
  partiallyLabeledRows: number;
  unlabeledRows: number;
  labelCoverage: number;
  issueKindAccuracy: number;
  issueKindMacroF1: number;
  issueKindWeightedF1: number;
  issueKindPerClass: TrajectoryCalibrationIssueKindMetrics[];
  predictedIssueKindCounts: TrajectoryIssueKindCountMap;
  manualIssueKindCounts: TrajectoryIssueKindCountMap;
  issueKindConfusionMatrix: TrajectoryIssueKindConfusionMatrix;
  harmfulMetrics: TrajectoryCalibrationHarmfulMetrics;
  abstain: TrajectoryCalibrationAbstainSummary;
}

function emptyIssueKindCountMap(): TrajectoryIssueKindCountMap {
  return {
    benign_probe: 0,
    transient_external: 0,
    command_mismatch: 0,
    environment_mismatch: 0,
    missing_context: 0,
    unknown_failure: 0,
  };
}

function emptyConfusionMatrix(): TrajectoryIssueKindConfusionMatrix {
  return {
    benign_probe: emptyIssueKindCountMap(),
    transient_external: emptyIssueKindCountMap(),
    command_mismatch: emptyIssueKindCountMap(),
    environment_mismatch: emptyIssueKindCountMap(),
    missing_context: emptyIssueKindCountMap(),
    unknown_failure: emptyIssueKindCountMap(),
  };
}

function safeDivide(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function binaryF1(precision: number, recall: number): number {
  return safeDivide(2 * precision * recall, precision + recall);
}

function isFullyLabeled(row: TrajectoryCalibrationSampleRow): boolean {
  return row.manualLabel.issueKind !== null && row.manualLabel.harmful !== null;
}

function isUnlabeled(row: TrajectoryCalibrationSampleRow): boolean {
  return row.manualLabel.issueKind === null && row.manualLabel.harmful === null;
}

export function summarizeTrajectoryCalibration(
  rows: TrajectoryCalibrationSampleRow[],
): TrajectoryCalibrationSummary {
  const predictedIssueKindCounts = emptyIssueKindCountMap();
  const manualIssueKindCounts = emptyIssueKindCountMap();
  const issueKindConfusionMatrix = emptyConfusionMatrix();

  let fullyLabeledRows = 0;
  let partiallyLabeledRows = 0;
  let unlabeledRows = 0;
  let issueKindCorrect = 0;

  let harmfulTruePositive = 0;
  let harmfulFalsePositive = 0;
  let harmfulFalseNegative = 0;
  let harmfulTrueNegative = 0;

  let harmfulSupport = 0;
  let harmlessSupport = 0;

  let predictedAbstainCount = 0;
  let abstainedHarmfulCount = 0;

  for (const row of rows) {
    predictedIssueKindCounts[row.predicted.issueKind] += 1;

    if (isUnlabeled(row)) {
      unlabeledRows += 1;
      continue;
    }

    if (!isFullyLabeled(row)) {
      partiallyLabeledRows += 1;
      continue;
    }

    fullyLabeledRows += 1;

    const manualIssueKind = row.manualLabel.issueKind;
    const manualHarmful = row.manualLabel.harmful;
    if (manualIssueKind === null || manualHarmful === null) {
      continue;
    }

    manualIssueKindCounts[manualIssueKind] += 1;
    issueKindConfusionMatrix[row.predicted.issueKind][manualIssueKind] += 1;

    if (row.predicted.issueKind === manualIssueKind) {
      issueKindCorrect += 1;
    }

    const predictedAbstained =
      row.predicted.abstained || row.predicted.issueKind === "unknown_failure";
    if (predictedAbstained) {
      predictedAbstainCount += 1;
    }

    if (manualHarmful) {
      harmfulSupport += 1;
      if (predictedAbstained) {
        abstainedHarmfulCount += 1;
      }

      if (row.predicted.harmful) {
        harmfulTruePositive += 1;
      } else {
        harmfulFalseNegative += 1;
      }
      continue;
    }

    harmlessSupport += 1;
    if (row.predicted.harmful) {
      harmfulFalsePositive += 1;
    } else {
      harmfulTrueNegative += 1;
    }
  }

  const issueKindPerClass = TRAJECTORY_CALIBRATION_ISSUE_KINDS.map((issueKind) => {
    const truePositive = issueKindConfusionMatrix[issueKind][issueKind];

    let predicted = 0;
    let support = 0;

    for (const label of TRAJECTORY_CALIBRATION_ISSUE_KINDS) {
      predicted += issueKindConfusionMatrix[issueKind][label];
      support += issueKindConfusionMatrix[label][issueKind];
    }

    const falsePositive = Math.max(0, predicted - truePositive);
    const falseNegative = Math.max(0, support - truePositive);

    const precision = safeDivide(truePositive, truePositive + falsePositive);
    const recall = safeDivide(truePositive, truePositive + falseNegative);
    const f1 = binaryF1(precision, recall);

    return {
      issueKind,
      support,
      predicted,
      truePositive,
      falsePositive,
      falseNegative,
      precision,
      recall,
      f1,
    };
  });

  const activeClassMetrics = issueKindPerClass.filter((metrics) => {
    return metrics.support > 0 || metrics.predicted > 0;
  });

  const issueKindMacroF1 =
    activeClassMetrics.length === 0
      ? 0
      : activeClassMetrics.reduce((sum, metrics) => {
          return sum + metrics.f1;
        }, 0) / activeClassMetrics.length;

  const totalSupport = issueKindPerClass.reduce((sum, metrics) => {
    return sum + metrics.support;
  }, 0);

  const issueKindWeightedF1 =
    totalSupport === 0
      ? 0
      : issueKindPerClass.reduce((sum, metrics) => {
          return sum + metrics.f1 * metrics.support;
        }, 0) / totalSupport;

  const issueKindAccuracy = safeDivide(issueKindCorrect, fullyLabeledRows);

  const harmfulPrecision = safeDivide(
    harmfulTruePositive,
    harmfulTruePositive + harmfulFalsePositive,
  );
  const harmfulRecall = safeDivide(
    harmfulTruePositive,
    harmfulTruePositive + harmfulFalseNegative,
  );

  const harmfulMetrics: TrajectoryCalibrationHarmfulMetrics = {
    supportPositive: harmfulSupport,
    supportNegative: harmlessSupport,
    truePositive: harmfulTruePositive,
    falsePositive: harmfulFalsePositive,
    falseNegative: harmfulFalseNegative,
    trueNegative: harmfulTrueNegative,
    precision: harmfulPrecision,
    recall: harmfulRecall,
    f1: binaryF1(harmfulPrecision, harmfulRecall),
    accuracy: safeDivide(harmfulTruePositive + harmfulTrueNegative, fullyLabeledRows),
    falsePositiveRate: safeDivide(
      harmfulFalsePositive,
      harmfulFalsePositive + harmfulTrueNegative,
    ),
    falseNegativeRate: safeDivide(
      harmfulFalseNegative,
      harmfulFalseNegative + harmfulTruePositive,
    ),
  };

  const abstain: TrajectoryCalibrationAbstainSummary = {
    predictedAbstainCount,
    predictedAbstainRate: safeDivide(predictedAbstainCount, fullyLabeledRows),
    judgeableCoverage: safeDivide(
      fullyLabeledRows - predictedAbstainCount,
      fullyLabeledRows,
    ),
    abstainedHarmfulCount,
    abstainedHarmfulRate: safeDivide(abstainedHarmfulCount, harmfulSupport),
  };

  return {
    totalRows: rows.length,
    fullyLabeledRows,
    partiallyLabeledRows,
    unlabeledRows,
    labelCoverage: safeDivide(fullyLabeledRows, rows.length),
    issueKindAccuracy,
    issueKindMacroF1,
    issueKindWeightedF1,
    issueKindPerClass,
    predictedIssueKindCounts,
    manualIssueKindCounts,
    issueKindConfusionMatrix,
    harmfulMetrics,
    abstain,
  };
}
