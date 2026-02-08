#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
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

type ParsedOptions = {
  sample: string;
  outDir: string;
  reviewerA: string;
  reviewerB: string;
  overlapRatio: number;
  seed: number;
  preserveExistingLabels: boolean;
  json: boolean;
};

type DualReviewPlan = {
  reviewerAId: string;
  reviewerBId: string;
  overlapRatio: number;
  seed: number;
  totalRows: number;
  overlapCount: number;
  reviewerA: {
    reviewerId: string;
    assignedCount: number;
    overlapCount: number;
    rowIds: string[];
  };
  reviewerB: {
    reviewerId: string;
    assignedCount: number;
    overlapCount: number;
    rowIds: string[];
  };
  assignments: Array<{
    rowId: string;
    reviewers: string[];
  }>;
};

function parseArgs(argv: string[]): ParsedOptions {
  const options: ParsedOptions = {
    sample: ".happy-paths/trajectory-calibration/sample.json",
    outDir: ".happy-paths/trajectory-calibration/review-pass-1",
    reviewerA: "reviewer_a",
    reviewerB: "reviewer_b",
    overlapRatio: 0.2,
    seed: 31,
    preserveExistingLabels: false,
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

    if (token === "--out-dir") {
      options.outDir = String(value);
      index += 1;
      continue;
    }

    if (token === "--reviewer-a") {
      options.reviewerA = String(value);
      index += 1;
      continue;
    }

    if (token === "--reviewer-b") {
      options.reviewerB = String(value);
      index += 1;
      continue;
    }

    if (token === "--overlap-ratio") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`invalid --overlap-ratio value: ${value}`);
      }
      options.overlapRatio = parsed;
      index += 1;
      continue;
    }

    if (token === "--seed") {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(`invalid --seed value: ${value}`);
      }
      options.seed = parsed;
      index += 1;
      continue;
    }

    if (token === "--preserve-existing-labels") {
      options.preserveExistingLabels = true;
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

function fileSafeReviewerId(reviewerId: string): string {
  return reviewerId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const distPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(distPath)) {
    throw new Error("dist/index.js not found. Run `npm run build` first.");
  }

  const {
    buildDualReviewPlan,
    buildReviewerPacketRows,
  }: {
    buildDualReviewPlan: (
      rows: TrajectoryCalibrationSampleRow[],
      options?: {
        reviewerAId?: string;
        reviewerBId?: string;
        overlapRatio?: number;
        seed?: number;
      },
    ) => DualReviewPlan;
    buildReviewerPacketRows: (
      rows: TrajectoryCalibrationSampleRow[],
      rowIds: string[],
      options?: {
        preserveExistingLabels?: boolean;
      },
    ) => TrajectoryCalibrationSampleRow[];
  } = await import(pathToFileURL(distPath).href);

  const samplePath = resolve(process.cwd(), options.sample);
  const sampleRaw = await readFile(samplePath, "utf-8");
  const samplePayload = JSON.parse(sampleRaw) as unknown;
  const sampleObject = asRecord(samplePayload);
  if (!sampleObject) {
    throw new Error(`invalid sample payload in ${samplePath}`);
  }

  const rawItems = Array.isArray(sampleObject.items)
    ? (sampleObject.items as unknown[])
    : [];
  const rows = toRows(rawItems);
  if (rows.length === 0) {
    throw new Error(`no calibration rows found in ${samplePath}`);
  }

  const plan = buildDualReviewPlan(rows, {
    reviewerAId: options.reviewerA,
    reviewerBId: options.reviewerB,
    overlapRatio: options.overlapRatio,
    seed: options.seed,
  });

  const packetRowsA = buildReviewerPacketRows(rows, plan.reviewerA.rowIds, {
    preserveExistingLabels: options.preserveExistingLabels,
  });
  const packetRowsB = buildReviewerPacketRows(rows, plan.reviewerB.rowIds, {
    preserveExistingLabels: options.preserveExistingLabels,
  });

  const generatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const outDirPath = resolve(process.cwd(), options.outDir);
  await mkdir(outDirPath, { recursive: true });

  const reviewerAFile = `${fileSafeReviewerId(plan.reviewerAId)}.json`;
  const reviewerBFile = `${fileSafeReviewerId(plan.reviewerBId)}.json`;

  const packetA = {
    schemaVersion: 1,
    generatedAtUtc,
    sourceSamplePath: samplePath,
    sourceSampleFile: basename(samplePath),
    reviewerId: plan.reviewerAId,
    reviewerPeerId: plan.reviewerBId,
    overlapRatio: plan.overlapRatio,
    overlapCount: plan.overlapCount,
    assignedCount: plan.reviewerA.assignedCount,
    totalRows: plan.totalRows,
    instructions:
      "Fill manualLabel.issueKind and manualLabel.harmful for each item. Use docs/trajectory-calibration-rubric.md.",
    items: packetRowsA,
  };

  const packetB = {
    schemaVersion: 1,
    generatedAtUtc,
    sourceSamplePath: samplePath,
    sourceSampleFile: basename(samplePath),
    reviewerId: plan.reviewerBId,
    reviewerPeerId: plan.reviewerAId,
    overlapRatio: plan.overlapRatio,
    overlapCount: plan.overlapCount,
    assignedCount: plan.reviewerB.assignedCount,
    totalRows: plan.totalRows,
    instructions:
      "Fill manualLabel.issueKind and manualLabel.harmful for each item. Use docs/trajectory-calibration-rubric.md.",
    items: packetRowsB,
  };

  const manifest = {
    schemaVersion: 1,
    generatedAtUtc,
    sourceSamplePath: samplePath,
    sourceSampleFile: basename(samplePath),
    reviewerAFile,
    reviewerBFile,
    plan,
  };

  await writeFile(
    join(outDirPath, reviewerAFile),
    `${JSON.stringify(packetA, null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    join(outDirPath, reviewerBFile),
    `${JSON.stringify(packetB, null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    join(outDirPath, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );

  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  console.log("Trajectory calibration dual-review packets prepared");
  console.log(`- source sample: ${samplePath}`);
  console.log(`- total rows: ${plan.totalRows}`);
  console.log(
    [
      "- overlap:",
      `${plan.overlapCount} rows`,
      `(${(plan.overlapRatio * 100).toFixed(1)}%)`,
    ].join(" "),
  );
  console.log(
    [
      "- reviewer A:",
      `${plan.reviewerAId} -> ${plan.reviewerA.assignedCount} rows`,
      `(file ${reviewerAFile})`,
    ].join(" "),
  );
  console.log(
    [
      "- reviewer B:",
      `${plan.reviewerBId} -> ${plan.reviewerB.assignedCount} rows`,
      `(file ${reviewerBFile})`,
    ].join(" "),
  );
  console.log(`- output dir: ${outDirPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
