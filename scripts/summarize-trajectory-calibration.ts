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

type ParsedOptions = {
  sample: string;
  out: string;
  maxExamples: number;
  json: boolean;
};

type CalibrationRow = {
  id: string;
  episodeId: string;
  familySignature: string;
  sessionId: string;
  startedAt: string;
  predicted: {
    issueKind: TrajectoryIssueKind;
    harmful: boolean;
    confidence: number;
    abstained: boolean;
    reason?: string;
  };
  manualLabel: {
    issueKind: TrajectoryIssueKind | null;
    harmful: boolean | null;
    notes?: string;
  };
  snippets?: {
    command?: string;
    outputFirstLine?: string;
  };
};

type CalibrationSummary = {
  totalRows: number;
  fullyLabeledRows: number;
  partiallyLabeledRows: number;
  unlabeledRows: number;
  labelCoverage: number;
  issueKindAccuracy: number;
  issueKindMacroF1: number;
  issueKindWeightedF1: number;
  harmfulMetrics: {
    precision: number;
    recall: number;
    f1: number;
    accuracy: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    trueNegative: number;
    supportPositive: number;
    supportNegative: number;
  };
  abstain: {
    predictedAbstainCount: number;
    predictedAbstainRate: number;
    judgeableCoverage: number;
    abstainedHarmfulCount: number;
    abstainedHarmfulRate: number;
  };
};

type ExampleRow = {
  id: string;
  episodeId: string;
  sessionId: string;
  startedAt: string;
  predictedIssueKind: TrajectoryIssueKind;
  manualIssueKind: TrajectoryIssueKind | null;
  predictedHarmful: boolean;
  manualHarmful: boolean | null;
  predictedAbstained: boolean;
  predictedConfidence: number;
  predictedReason: string;
  command: string;
  outputFirstLine: string;
  manualNotes: string;
};

const ISSUE_KINDS: TrajectoryIssueKind[] = [
  "benign_probe",
  "transient_external",
  "command_mismatch",
  "environment_mismatch",
  "missing_context",
  "unknown_failure",
];

function parseArgs(argv: string[]): ParsedOptions {
  const options: ParsedOptions = {
    sample: ".happy-paths/trajectory-calibration/sample.json",
    out: ".happy-paths/trajectory-calibration/summary.json",
    maxExamples: 20,
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

    if (token === "--out") {
      options.out = String(value);
      index += 1;
      continue;
    }

    if (token === "--max-examples") {
      const parsed = Number.parseInt(String(value), 10);
      options.maxExamples = Number.isFinite(parsed) ? Math.max(1, parsed) : 20;
      index += 1;
      continue;
    }

    if (token === "--json") {
      options.json = true;
    }
  }

  return options;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isIssueKind(value: unknown): value is TrajectoryIssueKind {
  return ISSUE_KINDS.includes(value as TrajectoryIssueKind);
}

function toRows(rawItems: unknown[]): CalibrationRow[] {
  const rows: CalibrationRow[] = [];

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
    const snippetsObject = asRecord(rowObject.snippets) ?? {};

    const manualIssueKind = isIssueKind(manualObject.issueKind)
      ? manualObject.issueKind
      : null;

    const manualHarmful =
      typeof manualObject.harmful === "boolean" ? manualObject.harmful : null;

    rows.push({
      id: asString(rowObject.id),
      episodeId: asString(rowObject.episodeId),
      familySignature: asString(rowObject.familySignature),
      sessionId: asString(rowObject.sessionId),
      startedAt: asString(rowObject.startedAt),
      predicted: {
        issueKind: predictedObject.issueKind,
        harmful: asBoolean(predictedObject.harmful),
        confidence: asNumber(predictedObject.confidence),
        abstained: asBoolean(predictedObject.abstained),
        reason: asString(predictedObject.reason),
      },
      manualLabel: {
        issueKind: manualIssueKind,
        harmful: manualHarmful,
        notes: asString(manualObject.notes),
      },
      snippets: {
        command: asString(snippetsObject.command),
        outputFirstLine: asString(snippetsObject.outputFirstLine),
      },
    });
  }

  return rows;
}

function isFullyLabeled(row: CalibrationRow): boolean {
  return row.manualLabel.issueKind !== null && row.manualLabel.harmful !== null;
}

function toExampleRow(row: CalibrationRow): ExampleRow {
  return {
    id: row.id,
    episodeId: row.episodeId,
    sessionId: row.sessionId,
    startedAt: row.startedAt,
    predictedIssueKind: row.predicted.issueKind,
    manualIssueKind: row.manualLabel.issueKind,
    predictedHarmful: row.predicted.harmful,
    manualHarmful: row.manualLabel.harmful,
    predictedAbstained:
      row.predicted.abstained || row.predicted.issueKind === "unknown_failure",
    predictedConfidence: row.predicted.confidence,
    predictedReason: row.predicted.reason ?? "",
    command: row.snippets?.command ?? "",
    outputFirstLine: row.snippets?.outputFirstLine ?? "",
    manualNotes: row.manualLabel.notes ?? "",
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

  const { summarizeTrajectoryCalibration } = await import(pathToFileURL(distPath).href);

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
  const summary = summarizeTrajectoryCalibration(rows) as CalibrationSummary;

  const labeledRows = rows.filter((row) => isFullyLabeled(row));

  const issueKindDisagreements = labeledRows
    .filter((row) => row.manualLabel.issueKind !== row.predicted.issueKind)
    .sort((left, right) => right.predicted.confidence - left.predicted.confidence)
    .slice(0, options.maxExamples)
    .map((row) => toExampleRow(row));

  const harmfulFalseNegatives = labeledRows
    .filter(
      (row) => row.manualLabel.harmful === true && row.predicted.harmful === false,
    )
    .sort((left, right) => right.predicted.confidence - left.predicted.confidence)
    .slice(0, options.maxExamples)
    .map((row) => toExampleRow(row));

  const harmfulFalsePositives = labeledRows
    .filter(
      (row) => row.manualLabel.harmful === false && row.predicted.harmful === true,
    )
    .sort((left, right) => right.predicted.confidence - left.predicted.confidence)
    .slice(0, options.maxExamples)
    .map((row) => toExampleRow(row));

  const abstainedButManualHarmful = labeledRows
    .filter((row) => {
      const predictedAbstained =
        row.predicted.abstained || row.predicted.issueKind === "unknown_failure";
      return predictedAbstained && row.manualLabel.harmful === true;
    })
    .sort((left, right) => right.predicted.confidence - left.predicted.confidence)
    .slice(0, options.maxExamples)
    .map((row) => toExampleRow(row));

  const payload = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    samplePath,
    sampleGeneratedAtUtc: asString(sampleObject.generatedAtUtc),
    sampleTraceRoot: asString(sampleObject.traceRoot),
    sampleHoldout: asRecord(sampleObject.holdout),
    totalRowsParsed: rows.length,
    summary,
    examples: {
      issueKindDisagreements,
      harmfulFalseNegatives,
      harmfulFalsePositives,
      abstainedButManualHarmful,
    },
  };

  const outPath = resolve(process.cwd(), options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Trajectory calibration summary");
  console.log(`- sample: ${samplePath}`);
  console.log(`- rows parsed: ${rows.length}`);
  console.log(
    [
      "- label coverage:",
      `${summary.fullyLabeledRows}/${summary.totalRows}`,
      `(${formatPercent(summary.labelCoverage)})`,
    ].join(" "),
  );
  console.log(
    [
      "- issue-kind metrics:",
      `accuracy=${summary.issueKindAccuracy.toFixed(3)},`,
      `macro_f1=${summary.issueKindMacroF1.toFixed(3)},`,
      `weighted_f1=${summary.issueKindWeightedF1.toFixed(3)}`,
    ].join(" "),
  );
  console.log(
    [
      "- harmful binary metrics:",
      `precision=${summary.harmfulMetrics.precision.toFixed(3)},`,
      `recall=${summary.harmfulMetrics.recall.toFixed(3)},`,
      `f1=${summary.harmfulMetrics.f1.toFixed(3)},`,
      `accuracy=${summary.harmfulMetrics.accuracy.toFixed(3)}`,
    ].join(" "),
  );
  console.log(
    [
      "- abstain:",
      `rate=${formatPercent(summary.abstain.predictedAbstainRate)},`,
      `judgeable_coverage=${formatPercent(summary.abstain.judgeableCoverage)},`,
      `harmful_abstain_rate=${formatPercent(summary.abstain.abstainedHarmfulRate)}`,
    ].join(" "),
  );
  console.log(
    [
      "- disagreement examples:",
      `issue_kind=${issueKindDisagreements.length},`,
      `harmful_fn=${harmfulFalseNegatives.length},`,
      `harmful_fp=${harmfulFalsePositives.length},`,
      `harmful_abstain=${abstainedButManualHarmful.length}`,
    ].join(" "),
  );
  console.log(`- summary output: ${outPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
