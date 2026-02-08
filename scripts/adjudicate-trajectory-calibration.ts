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

type ConflictPolicy = "unresolved" | "reviewer_a" | "reviewer_b" | "predicted";

type ParsedOptions = {
  sample: string;
  reviewerAFile: string;
  reviewerBFile: string;
  reviewerAId: string;
  reviewerBId: string;
  conflictPolicy: ConflictPolicy;
  out: string;
  summaryOut: string;
  requireComplete: boolean;
  json: boolean;
};

function parseConflictPolicy(value: string): ConflictPolicy {
  if (
    value === "unresolved" ||
    value === "reviewer_a" ||
    value === "reviewer_b" ||
    value === "predicted"
  ) {
    return value;
  }

  throw new Error(`invalid --conflict-policy value: ${value}`);
}

function parseArgs(argv: string[]): ParsedOptions {
  const options: ParsedOptions = {
    sample: ".happy-paths/trajectory-calibration/sample.json",
    reviewerAFile: ".happy-paths/trajectory-calibration/review-pass-1/reviewer_a.json",
    reviewerBFile: ".happy-paths/trajectory-calibration/review-pass-1/reviewer_b.json",
    reviewerAId: "reviewer_a",
    reviewerBId: "reviewer_b",
    conflictPolicy: "unresolved",
    out: ".happy-paths/trajectory-calibration/review-pass-1/adjudicated.json",
    summaryOut:
      ".happy-paths/trajectory-calibration/review-pass-1/adjudication-summary.json",
    requireComplete: false,
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

    if (token === "--reviewer-a-file") {
      options.reviewerAFile = String(value);
      index += 1;
      continue;
    }

    if (token === "--reviewer-b-file") {
      options.reviewerBFile = String(value);
      index += 1;
      continue;
    }

    if (token === "--reviewer-a-id") {
      options.reviewerAId = String(value);
      index += 1;
      continue;
    }

    if (token === "--reviewer-b-id") {
      options.reviewerBId = String(value);
      index += 1;
      continue;
    }

    if (token === "--conflict-policy") {
      options.conflictPolicy = parseConflictPolicy(String(value));
      index += 1;
      continue;
    }

    if (token === "--out") {
      options.out = String(value);
      index += 1;
      continue;
    }

    if (token === "--summary-out") {
      options.summaryOut = String(value);
      index += 1;
      continue;
    }

    if (token === "--require-complete") {
      options.requireComplete = true;
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
    const snippetsObject = asRecord(rowObject.snippets) ?? {};

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
        issueKind: isIssueKind(manualObject.issueKind) ? manualObject.issueKind : null,
        harmful:
          typeof manualObject.harmful === "boolean" ? manualObject.harmful : null,
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function readRowsFromPayload(path: string): Promise<{
  rows: TrajectoryCalibrationSampleRow[];
  payload: Record<string, unknown>;
}> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const payload = asRecord(parsed);
  if (!payload) {
    throw new Error(`invalid json payload: ${path}`);
  }

  const rawItems = Array.isArray(payload.items) ? (payload.items as unknown[]) : [];
  return {
    rows: toRows(rawItems),
    payload,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const distPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(distPath)) {
    throw new Error("dist/index.js not found. Run `npm run build` first.");
  }

  const {
    adjudicateTrajectoryCalibrationRows,
  }: {
    adjudicateTrajectoryCalibrationRows: (
      rows: TrajectoryCalibrationSampleRow[],
      reviewerARows: TrajectoryCalibrationSampleRow[],
      reviewerBRows: TrajectoryCalibrationSampleRow[],
      options?: {
        reviewerAId?: string;
        reviewerBId?: string;
        conflictPolicy?: ConflictPolicy;
      },
    ) => {
      reviewerAId: string;
      reviewerBId: string;
      conflictPolicy: ConflictPolicy;
      stats: Record<string, number>;
      conflicts: Array<Record<string, unknown>>;
      rows: TrajectoryCalibrationSampleRow[];
    };
  } = await import(pathToFileURL(distPath).href);

  const samplePath = resolve(process.cwd(), options.sample);
  const reviewerAPath = resolve(process.cwd(), options.reviewerAFile);
  const reviewerBPath = resolve(process.cwd(), options.reviewerBFile);

  const { rows: sampleRows, payload: samplePayload } =
    await readRowsFromPayload(samplePath);
  const { rows: reviewerARows, payload: reviewerAPayload } =
    await readRowsFromPayload(reviewerAPath);
  const { rows: reviewerBRows, payload: reviewerBPayload } =
    await readRowsFromPayload(reviewerBPath);

  if (sampleRows.length === 0) {
    throw new Error(`sample has no rows: ${samplePath}`);
  }

  const reviewerAId = options.reviewerAId || asString(reviewerAPayload.reviewerId);
  const reviewerBId = options.reviewerBId || asString(reviewerBPayload.reviewerId);

  const adjudication = adjudicateTrajectoryCalibrationRows(
    sampleRows,
    reviewerARows,
    reviewerBRows,
    {
      reviewerAId,
      reviewerBId,
      conflictPolicy: options.conflictPolicy,
    },
  );

  const generatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const outputPayload = {
    schemaVersion: 1,
    generatedAtUtc,
    sourceSamplePath: samplePath,
    reviewerAPath,
    reviewerBPath,
    reviewerAId: adjudication.reviewerAId,
    reviewerBId: adjudication.reviewerBId,
    conflictPolicy: adjudication.conflictPolicy,
    adjudicationStats: adjudication.stats,
    conflicts: adjudication.conflicts,
    items: adjudication.rows,
  };

  const summaryPayload = {
    schemaVersion: 1,
    generatedAtUtc,
    sourceSamplePath: samplePath,
    sampleGeneratedAtUtc: asString(samplePayload.generatedAtUtc),
    reviewerAPath,
    reviewerBPath,
    reviewerAId: adjudication.reviewerAId,
    reviewerBId: adjudication.reviewerBId,
    conflictPolicy: adjudication.conflictPolicy,
    stats: adjudication.stats,
    conflicts: adjudication.conflicts,
  };

  const outPath = resolve(process.cwd(), options.out);
  const summaryOutPath = resolve(process.cwd(), options.summaryOut);
  await mkdir(dirname(outPath), { recursive: true });
  await mkdir(dirname(summaryOutPath), { recursive: true });

  await writeFile(outPath, `${JSON.stringify(outputPayload, null, 2)}\n`, "utf-8");
  await writeFile(
    summaryOutPath,
    `${JSON.stringify(summaryPayload, null, 2)}\n`,
    "utf-8",
  );

  if (options.json) {
    console.log(JSON.stringify(summaryPayload, null, 2));
  } else {
    console.log("Trajectory calibration adjudication");
    console.log(`- sample: ${samplePath}`);
    console.log(`- reviewer A: ${reviewerAPath} (${adjudication.reviewerAId})`);
    console.log(`- reviewer B: ${reviewerBPath} (${adjudication.reviewerBId})`);
    console.log(`- conflict policy: ${adjudication.conflictPolicy}`);
    console.log(
      [
        "- label coverage:",
        `${adjudication.stats.adjudicatedRows}/${adjudication.stats.totalRows}`,
        `(${formatPercent(adjudication.stats.labelCoverage)})`,
      ].join(" "),
    );
    console.log(
      [
        "- overlap labeled:",
        `${adjudication.stats.labeledByBothReviewers}`,
        `agreed=${adjudication.stats.agreedByBothReviewers},`,
        `conflicts=${adjudication.stats.conflicts},`,
        `unresolved=${adjudication.stats.unresolvedConflicts}`,
      ].join(" "),
    );
    console.log(`- adjudicated output: ${outPath}`);
    console.log(`- summary output: ${summaryOutPath}`);
  }

  if (
    options.requireComplete &&
    (adjudication.stats.remainingUnlabeledRows > 0 ||
      adjudication.stats.unresolvedConflicts > 0)
  ) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
