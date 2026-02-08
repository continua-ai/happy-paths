#!/usr/bin/env node

import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseFloatOrUndefined(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid number: ${value}`);
  }
  return parsed;
}

function parseIntOrUndefined(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid integer: ${value}`);
  }
  return parsed;
}

function parseFormat(value: string): "auto" | "trace" | "pi" {
  if (value === "auto" || value === "trace" || value === "pi") {
    return value;
  }
  throw new Error(`invalid --format value: ${value}`);
}

function parseArgs(argv: string[]) {
  const options = {
    traceRoot: ".happy-paths",
    format: "auto" as "auto" | "trace" | "pi",
    toolName: "bash",
    harness: "pi",
    scope: "personal",
    strict: false,
    json: false,
    minOccurrencesPerFamily: 2,
    requireCrossSession: true,
    maxWallTimeRatio: undefined as number | undefined,
    maxTokenCountRatio: undefined as number | undefined,
    thresholds: {} as {
      minPairCount?: number;
      minRelativeDeadEndReduction?: number;
      minRelativeWallTimeReduction?: number;
      minRelativeTokenCountReduction?: number;
      minRelativeTokenProxyReduction?: number;
      minRecoverySuccessRateOn?: number;
      maxRecoverySuccessRateDrop?: number;
    },
    bootstrapSamples: undefined as number | undefined,
    confidenceLevel: undefined as number | undefined,
    seed: undefined as number | undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--trace-root") {
      options.traceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--format") {
      options.format = parseFormat(String(value));
      index += 1;
      continue;
    }
    if (token === "--tool-name") {
      options.toolName = String(value);
      index += 1;
      continue;
    }
    if (token === "--harness") {
      options.harness = String(value);
      index += 1;
      continue;
    }
    if (token === "--scope") {
      options.scope = String(value);
      index += 1;
      continue;
    }
    if (token === "--min-occurrences-per-family") {
      options.minOccurrencesPerFamily = parseIntOrUndefined(value) ?? 2;
      index += 1;
      continue;
    }
    if (token === "--allow-same-session") {
      options.requireCrossSession = false;
      continue;
    }
    if (token === "--max-wall-time-ratio") {
      options.maxWallTimeRatio = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-token-count-ratio") {
      options.maxTokenCountRatio = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-pair-count") {
      options.thresholds.minPairCount = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-dead-end-reduction") {
      options.thresholds.minRelativeDeadEndReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-wall-time-reduction") {
      options.thresholds.minRelativeWallTimeReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-token-count-reduction") {
      options.thresholds.minRelativeTokenCountReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-relative-token-proxy-reduction") {
      options.thresholds.minRelativeTokenProxyReduction = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--min-recovery-success-rate-on") {
      options.thresholds.minRecoverySuccessRateOn = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-recovery-success-rate-drop") {
      options.thresholds.maxRecoverySuccessRateDrop = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--bootstrap-samples") {
      options.bootstrapSamples = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--confidence-level") {
      options.confidenceLevel = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--seed") {
      options.seed = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--strict") {
      options.strict = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
    }
  }

  return options;
}

async function collectJsonlFiles(rootPath: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl") {
        output.push(absolutePath);
      }
    }
  }

  await walk(rootPath);
  return output;
}

function sessionHintFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() || "session";
  return fileName.replace(/\.jsonl$/i, "");
}

function parseJsonlRecords(raw: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  return records;
}

function isTraceEventRecord(record: Record<string, unknown>): boolean {
  return (
    typeof record.id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.harness === "string" &&
    typeof record.scope === "string" &&
    typeof record.type === "string" &&
    typeof record.payload === "object" &&
    record.payload !== null
  );
}

function formatInterval(
  interval: { low: number; median: number; high: number },
  digits = 3,
): string {
  return `${interval.low.toFixed(digits)} / ${interval.median.toFixed(digits)} / ${interval.high.toFixed(digits)}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const distPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(distPath)) {
    throw new Error("dist/index.js not found. Run `npm run build` first.");
  }

  const {
    buildTraceEventsFromPiSessionRecords,
    evaluateObservedAbGate,
    extractObservedAbEpisodes,
  } = await import(pathToFileURL(distPath).href);

  const traceRoot = resolve(process.cwd(), options.traceRoot);
  const traceFiles = await collectJsonlFiles(traceRoot);

  if (traceFiles.length === 0) {
    throw new Error(`no .jsonl files found under ${traceRoot}`);
  }

  const allEvents = [];
  let traceEventFilesScanned = 0;
  let piSessionFilesScanned = 0;
  let skippedForFormat = 0;

  for (const traceFile of traceFiles) {
    const raw = await readFile(traceFile, "utf-8");
    const records = parseJsonlRecords(raw);
    if (records.length === 0) {
      continue;
    }

    const traceEvents = records.filter(isTraceEventRecord);
    const shouldUseTraceFormat =
      options.format === "trace" ||
      (options.format === "auto" && traceEvents.length > 0);

    if (shouldUseTraceFormat) {
      if (traceEvents.length === 0) {
        skippedForFormat += 1;
        continue;
      }

      traceEventFilesScanned += 1;
      allEvents.push(...traceEvents);
      continue;
    }

    piSessionFilesScanned += 1;
    const converted = buildTraceEventsFromPiSessionRecords(records, {
      sessionId: sessionHintFromPath(traceFile),
      harness: options.harness,
      scope: options.scope,
      toolName: options.toolName,
    });
    allEvents.push(...converted);
  }

  const episodes = extractObservedAbEpisodes(allEvents);
  const report = evaluateObservedAbGate(
    episodes,
    options.thresholds,
    {
      minOccurrencesPerFamily: options.minOccurrencesPerFamily,
      requireCrossSession: options.requireCrossSession,
      maxWallTimeRatio: options.maxWallTimeRatio,
      maxTokenCountRatio: options.maxTokenCountRatio,
    },
    {
      bootstrapSamples: options.bootstrapSamples,
      confidenceLevel: options.confidenceLevel,
      seed: options.seed,
    },
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          traceRoot,
          format: options.format,
          toolName: options.toolName,
          traceFilesFound: traceFiles.length,
          traceEventFilesScanned,
          piSessionFilesScanned,
          skippedForFormat,
          ...report,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("Observed A/B gate summary");
    console.log(`- trace files: ${traceFiles.length}`);
    console.log(
      [
        "- files used:",
        `trace-events=${traceEventFilesScanned},`,
        `pi-sessions=${piSessionFilesScanned},`,
        `skipped=${skippedForFormat}`,
      ].join(" "),
    );
    console.log(`- episodes extracted: ${report.episodes.length}`);
    console.log(`- pairs: ${report.aggregate.totalPairs}`);

    const uniqueFamilies = new Set(report.pairs.map((pair) => pair.familySignature));
    console.log(`- repeated families with pairs: ${uniqueFamilies.size}`);

    console.log(
      [
        "- pairing filters:",
        `min_occurrences=${report.pairing.minOccurrencesPerFamily},`,
        `cross_session=${report.pairing.requireCrossSession},`,
        `max_wall_ratio=${report.pairing.maxWallTimeRatio.toFixed(2)},`,
        `max_token_ratio=${report.pairing.maxTokenCountRatio.toFixed(2)}`,
      ].join(" "),
    );
    console.log(
      [
        "- pairing diagnostics:",
        `families_seen=${report.pairingDiagnostics.familiesSeen},`,
        `families_eligible=${report.pairingDiagnostics.familiesEligible},`,
        `candidate_transitions=${report.pairingDiagnostics.candidateTransitions},`,
        `dropped_same_session=${report.pairingDiagnostics.droppedSameSession},`,
        `dropped_outlier_ratio=${report.pairingDiagnostics.droppedOutlierRatio}`,
      ].join(" "),
    );

    console.log("- observed OFF -> ON deltas (measured):");
    console.log(
      [
        "  - retries per pair:",
        `${report.aggregate.repeatedDeadEndRateOff.toFixed(3)} ->`,
        report.aggregate.repeatedDeadEndRateOn.toFixed(3),
        `(relative reduction ${report.aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3)})`,
      ].join(" "),
    );
    console.log(
      [
        "  - wall time s:",
        `${(report.aggregate.totalWallTimeOffMs / 1000).toFixed(2)} ->`,
        (report.aggregate.totalWallTimeOnMs / 1000).toFixed(2),
        `(relative reduction ${report.aggregate.relativeWallTimeReduction.toFixed(3)})`,
      ].join(" "),
    );
    console.log(
      [
        "  - token count:",
        `${report.aggregate.totalTokenCountOff.toFixed(0)} ->`,
        report.aggregate.totalTokenCountOn.toFixed(0),
        `(relative reduction ${report.aggregate.relativeTokenCountReduction.toFixed(3)})`,
      ].join(" "),
    );
    console.log(
      [
        "  - token proxy:",
        `${report.aggregate.totalTokenProxyOff.toFixed(1)} ->`,
        report.aggregate.totalTokenProxyOn.toFixed(1),
        `(relative reduction ${report.aggregate.relativeTokenProxyReduction.toFixed(3)})`,
      ].join(" "),
    );
    console.log(
      [
        "  - recovery success:",
        `${report.aggregate.recoverySuccessRateOff.toFixed(3)} ->`,
        report.aggregate.recoverySuccessRateOn.toFixed(3),
        `(delta ${report.aggregate.absoluteRecoverySuccessRateDelta.toFixed(3)})`,
      ].join(" "),
    );

    console.log(
      [
        "- trust (paired bootstrap):",
        `${report.trustSummary.sampleCount} samples,`,
        `${(report.trustSummary.confidenceLevel * 100).toFixed(1)}% CI`,
      ].join(" "),
    );
    console.log(
      [
        "  - dead-end reduction (low/median/high):",
        formatInterval(report.trustSummary.deadEndReduction),
      ].join(" "),
    );
    console.log(
      [
        "  - wall-time reduction (low/median/high):",
        formatInterval(report.trustSummary.wallTimeReduction),
      ].join(" "),
    );
    console.log(
      [
        "  - token-count reduction (low/median/high):",
        formatInterval(report.trustSummary.tokenCountReduction),
      ].join(" "),
    );
    console.log(
      [
        "  - token-proxy reduction (low/median/high):",
        formatInterval(report.trustSummary.tokenProxyReduction),
      ].join(" "),
    );
    console.log(
      [
        "  - expected dead-ends avoided (low/median/high):",
        formatInterval(report.trustSummary.expectedDeadEndsAvoided, 1),
      ].join(" "),
    );

    console.log(`- gate pass: ${report.gateResult.pass}`);
    if (!report.gateResult.pass) {
      console.log("- gate failures:");
      for (const failure of report.gateResult.failures) {
        console.log(`  - ${failure}`);
      }
    }
  }

  if (options.strict && !report.gateResult.pass) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
