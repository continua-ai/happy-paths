#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type TrajectoryIssueKind =
  | "benign_probe"
  | "transient_external"
  | "command_mismatch"
  | "environment_mismatch"
  | "missing_context"
  | "unknown_failure";

type TrajectoryCalibrationSampleRow = {
  id: string;
  predicted: {
    issueKind: TrajectoryIssueKind;
    harmful: boolean;
    confidence: number;
    abstained: boolean;
  };
  manualLabel: {
    issueKind: TrajectoryIssueKind | null;
    harmful: boolean | null;
  };
};

type ParsedOptions = {
  sample: string;
  minThreshold: number;
  maxThreshold: number;
  step: number;
  minPrecision: number;
  minJudgeableCoverage: number;
  minRecall: number;
  topK: number;
  out: string;
  json: boolean;
};

type ThresholdMetrics = {
  threshold: number;
  totalRows: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  abstainCount: number;
  abstainRate: number;
  judgeableCoverage: number;
  harmfulAbstainCount: number;
  harmfulAbstainRate: number;
  eligible: boolean;
};

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): ParsedOptions {
  const options: ParsedOptions = {
    sample: ".happy-paths/trajectory-calibration/review-pass-1/adjudicated.json",
    minThreshold: 0,
    maxThreshold: 0.95,
    step: 0.01,
    minPrecision: 0.85,
    minJudgeableCoverage: 0.6,
    minRecall: 0,
    topK: 10,
    out: ".happy-paths/trajectory-calibration/review-pass-1/threshold-tuning.json",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--sample") {
      options.sample = String(value);
      index += 1;
      continue;
    }

    if (token === "--min-threshold") {
      options.minThreshold = parseNumber(value, options.minThreshold);
      index += 1;
      continue;
    }

    if (token === "--max-threshold") {
      options.maxThreshold = parseNumber(value, options.maxThreshold);
      index += 1;
      continue;
    }

    if (token === "--step") {
      options.step = Math.max(0.001, parseNumber(value, options.step));
      index += 1;
      continue;
    }

    if (token === "--min-precision") {
      options.minPrecision = parseNumber(value, options.minPrecision);
      index += 1;
      continue;
    }

    if (token === "--min-judgeable-coverage") {
      options.minJudgeableCoverage = parseNumber(value, options.minJudgeableCoverage);
      index += 1;
      continue;
    }

    if (token === "--min-recall") {
      options.minRecall = parseNumber(value, options.minRecall);
      index += 1;
      continue;
    }

    if (token === "--top-k") {
      options.topK = Math.max(1, Math.floor(parseNumber(value, options.topK)));
      index += 1;
      continue;
    }

    if (token === "--out") {
      options.out = String(value);
      index += 1;
      continue;
    }

    if (token === "--json") {
      options.json = true;
    }
  }

  if (options.maxThreshold < options.minThreshold) {
    const previousMin = options.minThreshold;
    options.minThreshold = options.maxThreshold;
    options.maxThreshold = previousMin;
  }

  options.minPrecision = Math.max(0, Math.min(1, options.minPrecision));
  options.minJudgeableCoverage = Math.max(0, Math.min(1, options.minJudgeableCoverage));
  options.minRecall = Math.max(0, Math.min(1, options.minRecall));

  return options;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function isIssueKind(value: unknown): value is TrajectoryIssueKind {
  return (
    value === "benign_probe" ||
    value === "transient_external" ||
    value === "command_mismatch" ||
    value === "environment_mismatch" ||
    value === "missing_context" ||
    value === "unknown_failure"
  );
}

function toRows(rawItems: unknown[]): TrajectoryCalibrationSampleRow[] {
  const rows: TrajectoryCalibrationSampleRow[] = [];

  for (const item of rawItems) {
    const rowObject = asRecord(item);
    if (!rowObject) {
      continue;
    }

    const predictedObject = asRecord(rowObject.predicted);
    if (!predictedObject || !isIssueKind(predictedObject.issueKind)) {
      continue;
    }

    const manualObject = asRecord(rowObject.manualLabel) ?? {};

    rows.push({
      id: String(rowObject.id ?? ""),
      predicted: {
        issueKind: predictedObject.issueKind,
        harmful: asBoolean(predictedObject.harmful),
        confidence: asNumber(predictedObject.confidence),
        abstained: asBoolean(predictedObject.abstained),
      },
      manualLabel: {
        issueKind: isIssueKind(manualObject.issueKind) ? manualObject.issueKind : null,
        harmful:
          typeof manualObject.harmful === "boolean" ? manualObject.harmful : null,
      },
    });
  }

  return rows;
}

function safeDivide(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function harmonicMean(precision: number, recall: number): number {
  return safeDivide(2 * precision * recall, precision + recall);
}

function evaluateThreshold(
  rows: TrajectoryCalibrationSampleRow[],
  threshold: number,
  options: ParsedOptions,
): ThresholdMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  let abstainCount = 0;
  let harmfulAbstainCount = 0;
  let harmfulSupport = 0;

  let totalRows = 0;

  for (const row of rows) {
    const manualHarmful = row.manualLabel.harmful;
    if (manualHarmful === null) {
      continue;
    }

    totalRows += 1;

    const abstained =
      row.predicted.abstained ||
      row.predicted.issueKind === "unknown_failure" ||
      row.predicted.confidence < threshold;

    if (abstained) {
      abstainCount += 1;
    }

    if (manualHarmful) {
      harmfulSupport += 1;
      if (abstained) {
        harmfulAbstainCount += 1;
      }
    }

    const predictedHarmful = !abstained && row.predicted.harmful;

    if (manualHarmful && predictedHarmful) {
      tp += 1;
      continue;
    }

    if (!manualHarmful && predictedHarmful) {
      fp += 1;
      continue;
    }

    if (manualHarmful && !predictedHarmful) {
      fn += 1;
      continue;
    }

    tn += 1;
  }

  const precision = safeDivide(tp, tp + fp);
  const recall = safeDivide(tp, tp + fn);
  const f1 = harmonicMean(precision, recall);
  const accuracy = safeDivide(tp + tn, totalRows);
  const abstainRate = safeDivide(abstainCount, totalRows);
  const judgeableCoverage = 1 - abstainRate;
  const harmfulAbstainRate = safeDivide(harmfulAbstainCount, harmfulSupport);

  const eligible =
    precision >= options.minPrecision &&
    judgeableCoverage >= options.minJudgeableCoverage &&
    recall >= options.minRecall;

  return {
    threshold,
    totalRows,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1,
    accuracy,
    abstainCount,
    abstainRate,
    judgeableCoverage,
    harmfulAbstainCount,
    harmfulAbstainRate,
    eligible,
  };
}

function selectRecommended(metrics: ThresholdMetrics[]): {
  recommended: ThresholdMetrics;
  usedEligibleFilter: boolean;
} {
  const eligible = metrics.filter((entry) => entry.eligible);
  const source = eligible.length > 0 ? eligible : metrics;

  const sorted = [...source].sort((left, right) => {
    if (left.f1 !== right.f1) {
      return right.f1 - left.f1;
    }
    if (left.recall !== right.recall) {
      return right.recall - left.recall;
    }
    if (left.precision !== right.precision) {
      return right.precision - left.precision;
    }
    if (left.judgeableCoverage !== right.judgeableCoverage) {
      return right.judgeableCoverage - left.judgeableCoverage;
    }
    return left.threshold - right.threshold;
  });

  return {
    recommended: sorted[0] as ThresholdMetrics,
    usedEligibleFilter: eligible.length > 0,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const distPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(distPath)) {
    throw new Error("dist/index.js not found. Run `npm run build` first.");
  }

  // Ensures build artifact exports remain valid for this script path.
  await import(pathToFileURL(distPath).href);

  const samplePath = resolve(process.cwd(), options.sample);
  const sampleRaw = await readFile(samplePath, "utf-8");
  const sampleParsed = JSON.parse(sampleRaw) as unknown;
  const sampleObject = asRecord(sampleParsed);
  if (!sampleObject) {
    throw new Error(`invalid sample payload in ${samplePath}`);
  }

  const rawItems = Array.isArray(sampleObject.items)
    ? (sampleObject.items as unknown[])
    : [];

  const rows = toRows(rawItems);
  if (rows.length === 0) {
    throw new Error(`no rows found in ${samplePath}`);
  }

  const evaluatedRows = rows.filter((row) => row.manualLabel.harmful !== null);
  if (evaluatedRows.length === 0) {
    throw new Error(`no fully-labeled rows found in ${samplePath}`);
  }

  const metrics: ThresholdMetrics[] = [];
  for (
    let threshold = options.minThreshold;
    threshold <= options.maxThreshold + 1e-9;
    threshold += options.step
  ) {
    const normalizedThreshold = Number(threshold.toFixed(4));
    metrics.push(evaluateThreshold(evaluatedRows, normalizedThreshold, options));
  }

  const { recommended, usedEligibleFilter } = selectRecommended(metrics);

  const topCandidates = [...metrics]
    .sort((left, right) => {
      if (left.eligible !== right.eligible) {
        return left.eligible ? -1 : 1;
      }
      if (left.f1 !== right.f1) {
        return right.f1 - left.f1;
      }
      if (left.recall !== right.recall) {
        return right.recall - left.recall;
      }
      if (left.precision !== right.precision) {
        return right.precision - left.precision;
      }
      return left.threshold - right.threshold;
    })
    .slice(0, options.topK);

  const payload = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    samplePath,
    sampleGeneratedAtUtc: String(sampleObject.generatedAtUtc ?? ""),
    totalRows: rows.length,
    labeledRows: evaluatedRows.length,
    constraints: {
      minPrecision: options.minPrecision,
      minJudgeableCoverage: options.minJudgeableCoverage,
      minRecall: options.minRecall,
    },
    search: {
      minThreshold: options.minThreshold,
      maxThreshold: options.maxThreshold,
      step: options.step,
      testedThresholdCount: metrics.length,
    },
    recommended: {
      ...recommended,
      usedEligibleFilter,
    },
    topCandidates,
    metrics,
  };

  const outPath = resolve(process.cwd(), options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Trajectory calibration threshold tuning");
  console.log(`- sample: ${samplePath}`);
  console.log(`- labeled rows: ${evaluatedRows.length}/${rows.length}`);
  console.log(
    [
      "- constraints:",
      `precision>=${options.minPrecision.toFixed(2)},`,
      `judgeable>=${options.minJudgeableCoverage.toFixed(2)},`,
      `recall>=${options.minRecall.toFixed(2)}`,
    ].join(" "),
  );
  console.log(
    [
      "- recommended threshold:",
      recommended.threshold.toFixed(2),
      `(eligible-filter=${usedEligibleFilter ? "on" : "off"})`,
    ].join(" "),
  );
  console.log(
    [
      "- recommended metrics:",
      `precision=${recommended.precision.toFixed(3)},`,
      `recall=${recommended.recall.toFixed(3)},`,
      `f1=${recommended.f1.toFixed(3)},`,
      `judgeable=${formatPercent(recommended.judgeableCoverage)},`,
      `harmful_abstain=${formatPercent(recommended.harmfulAbstainRate)}`,
    ].join(" "),
  );
  console.log(`- tuning output: ${outPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
