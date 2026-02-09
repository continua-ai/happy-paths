#!/usr/bin/env node

import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type JsonRecord = Record<string, unknown>;

type Format = "auto" | "trace" | "pi";

type Scope = "personal" | "team" | "public";

type ParsedOptions = {
  traceRoot: string;
  format: Format;
  toolName: string;
  harness: string;
  scope: Scope;
  minSessionDurationMs: number;
  minTotalLatencyMs: number;
  minToolResultCount: number;
  evalRatio: number;
  strictNoFamilyOverlap: boolean;
  strict: boolean;
  json: boolean;
  out: string;
  thresholds: {
    minPairCount?: number;
    minRelativeDeadEndReduction?: number;
    minRelativeWallTimeReduction?: number;
    minRelativeTokenCountReduction?: number;
    minRelativeTokenProxyReduction?: number;
    minRecoverySuccessRateOn?: number;
    maxRecoverySuccessRateDrop?: number;
  };
  pairing: {
    minOccurrencesPerFamily?: number;
    requireCrossSession?: boolean;
    maxWallTimeRatio?: number;
    maxTokenCountRatio?: number;
  };
  trust: {
    bootstrapSamples?: number;
    confidenceLevel?: number;
    seed?: number;
  };
};

type SessionEnvelope = {
  sessionId: string;
  events: Array<Record<string, unknown>>;
  traceFiles: Set<string>;
  modelKeys: Set<string>;
};

type ObservedStratumAggregate = {
  totalPairs: number;
  totalRetriesOff: number;
  totalRetriesOn: number;
  repeatedDeadEndRateOff: number;
  repeatedDeadEndRateOn: number;
  recoverySuccessRateOff: number;
  recoverySuccessRateOn: number;
  totalWallTimeOffMs: number;
  totalWallTimeOnMs: number;
  totalTokenCountOff: number;
  totalTokenCountOn: number;
  totalTokenProxyOff: number;
  totalTokenProxyOn: number;
  totalCostOffUsd: number;
  totalCostOnUsd: number;
  relativeRepeatedDeadEndRateReduction: number;
  relativeWallTimeReduction: number;
  relativeTokenCountReduction: number;
  relativeTokenProxyReduction: number;
  absoluteRecoverySuccessRateDelta: number;
};

type ObservedStratumSummary = {
  key: string;
  pairCount: number;
  episodeCount: number;
  sessionCount: number;
  aggregate: ObservedStratumAggregate;
  gateResult: {
    pass: boolean;
    failures: string[];
  };
};

type ObservedStrata = {
  model: ObservedStratumSummary[];
  toolSurface: ObservedStratumSummary[];
  modelToolSurface: ObservedStratumSummary[];
};

type ObservedPairLike = {
  familySignature: string;
  offSessionId: string;
  onSessionId: string;
  retriesOff: number;
  retriesOn: number;
  wallTimeOffMs: number;
  wallTimeOnMs: number;
  tokenCountOff: number;
  tokenCountOn: number;
  tokenProxyOff: number;
  tokenProxyOn: number;
  costOffUsd: number;
  costOnUsd: number;
  successOff: boolean;
  successOn: boolean;
};

type ObservedEpisodeLike = {
  id: string;
  sessionId: string;
  familySignature: string;
};

type ObservedThresholdsLike = {
  minPairCount: number;
  minRelativeDeadEndReduction: number;
  minRelativeWallTimeReduction: number;
  minRelativeTokenCountReduction: number;
  minRelativeTokenProxyReduction: number;
  minRecoverySuccessRateOn: number;
  maxRecoverySuccessRateDrop: number;
};

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

function parseFormat(value: string): Format {
  if (value === "auto" || value === "trace" || value === "pi") {
    return value;
  }
  throw new Error(`invalid --format value: ${value}`);
}

function parseScope(value: string): Scope {
  if (value === "personal" || value === "team" || value === "public") {
    return value;
  }
  throw new Error(`invalid --scope value: ${value}`);
}

function normalizeEvalRatio(value: number | undefined): number {
  if (value === undefined) {
    return 0.3;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`invalid eval ratio: ${value}`);
  }
  return Math.max(0.05, Math.min(0.95, value));
}

function parseArgs(argv: string[]): ParsedOptions {
  const options: ParsedOptions = {
    traceRoot: ".happy-paths",
    format: "auto",
    toolName: "bash",
    harness: "pi",
    scope: "personal",
    minSessionDurationMs: 15 * 60 * 1000,
    minTotalLatencyMs: 5 * 60 * 1000,
    minToolResultCount: 8,
    evalRatio: 0.3,
    strictNoFamilyOverlap: false,
    strict: false,
    json: false,
    out: ".happy-paths/observed-ab-long-horizon/report.json",
    thresholds: {},
    pairing: {},
    trust: {},
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
      options.scope = parseScope(String(value));
      index += 1;
      continue;
    }
    if (token === "--min-session-duration-ms") {
      options.minSessionDurationMs = Math.max(0, parseIntOrUndefined(value) ?? 0);
      index += 1;
      continue;
    }
    if (token === "--min-total-latency-ms") {
      options.minTotalLatencyMs = Math.max(0, parseIntOrUndefined(value) ?? 0);
      index += 1;
      continue;
    }
    if (token === "--min-tool-result-count") {
      options.minToolResultCount = Math.max(1, parseIntOrUndefined(value) ?? 1);
      index += 1;
      continue;
    }
    if (token === "--eval-ratio") {
      options.evalRatio = normalizeEvalRatio(parseFloatOrUndefined(value));
      index += 1;
      continue;
    }
    if (token === "--out") {
      options.out = String(value);
      index += 1;
      continue;
    }
    if (token === "--strict-no-family-overlap") {
      options.strictNoFamilyOverlap = true;
      continue;
    }
    if (token === "--min-occurrences-per-family") {
      options.pairing.minOccurrencesPerFamily = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--allow-same-session") {
      options.pairing.requireCrossSession = false;
      continue;
    }
    if (token === "--max-wall-time-ratio") {
      options.pairing.maxWallTimeRatio = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-token-count-ratio") {
      options.pairing.maxTokenCountRatio = parseFloatOrUndefined(value);
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
      options.trust.bootstrapSamples = parseIntOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--confidence-level") {
      options.trust.confidenceLevel = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--seed") {
      options.trust.seed = parseIntOrUndefined(value);
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

function parseJsonlRecords(raw: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as JsonRecord);
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return records;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function modelKeyFromRecord(record: JsonRecord): string | null {
  const recordType = record.type;
  if (recordType === "model_change") {
    const modelId = record.modelId;
    const provider = record.provider;
    if (typeof modelId !== "string" || !modelId.trim()) {
      return null;
    }
    if (typeof provider === "string" && provider.trim()) {
      return `${provider.trim()}/${modelId.trim()}`;
    }
    return modelId.trim();
  }

  if (recordType === "message") {
    const provider = record.provider;
    const model = record.model;
    if (typeof model === "string" && model.trim()) {
      if (typeof provider === "string" && provider.trim()) {
        return `${provider.trim()}/${model.trim()}`;
      }
      return model.trim();
    }

    const message = asRecord(record.message);
    if (!message) {
      return null;
    }

    const nestedProvider = message.provider;
    const nestedModel = message.model;
    if (typeof nestedModel === "string" && nestedModel.trim()) {
      if (typeof nestedProvider === "string" && nestedProvider.trim()) {
        return `${nestedProvider.trim()}/${nestedModel.trim()}`;
      }
      return nestedModel.trim();
    }
  }

  return null;
}

function detectModelKeyFromRecords(records: JsonRecord[]): string {
  for (const record of records) {
    const modelKey = modelKeyFromRecord(record);
    if (modelKey) {
      return modelKey;
    }
  }
  return "unknown";
}

function resolveSessionModelKey(modelKeys: Set<string>): string {
  const known = [...modelKeys].filter((key) => key !== "unknown");
  if (known.length === 0) {
    return "unknown";
  }

  const uniqueKnown = [...new Set(known)].sort();
  if (uniqueKnown.length === 1) {
    return uniqueKnown[0] ?? "unknown";
  }

  return `mixed:${uniqueKnown.join("|")}`;
}

function modelKeyForPair(
  offSessionId: string,
  onSessionId: string,
  sessionModelKeys: Map<string, string>,
): string {
  const offModel = sessionModelKeys.get(offSessionId) ?? "unknown";
  const onModel = sessionModelKeys.get(onSessionId) ?? "unknown";
  if (offModel === onModel) {
    return offModel;
  }
  const unique = [...new Set([offModel, onModel])].sort();
  return `mixed:${unique.join("|")}`;
}

function inferToolSurfaceKey(familySignature: string): string {
  const normalized = familySignature.trim().toLowerCase();
  const command = normalized.split(/\s+/, 1)[0] ?? "";

  if (!command) {
    return "other";
  }
  if (command === "gcloud") {
    return "cloud:gcloud";
  }
  if (command === "gh") {
    return "git:github_cli";
  }
  if (command === "git") {
    return "git";
  }
  if (command === "terraform") {
    return "infra:terraform";
  }
  if (command === "pants") {
    return "build:pants";
  }
  if (command === "kubectl" || command === "helm") {
    return "k8s";
  }
  if (command === "docker") {
    return "container:docker";
  }
  if (
    command === "npm" ||
    command === "npx" ||
    command === "pnpm" ||
    command === "yarn" ||
    command === "node" ||
    command === "bun"
  ) {
    return "js-toolchain";
  }
  if (
    command === "python" ||
    command === "python3" ||
    command === "pip" ||
    command === "pip3" ||
    command === "uv" ||
    command === "pytest"
  ) {
    return "python-toolchain";
  }
  if (command === "go" || command === "gofmt" || command === "goimports") {
    return "go-toolchain";
  }
  if (command === "curl" || command === "wget" || command === "http") {
    return "http-probe";
  }
  if (
    command === "rg" ||
    command === "grep" ||
    command === "find" ||
    command === "ls" ||
    command === "bash" ||
    command === "zsh" ||
    command === "sh"
  ) {
    return "shell";
  }

  return "other";
}

function relativeReduction(off: number, on: number): number {
  if (off <= 0) {
    return on <= 0 ? 0 : -1;
  }
  return (off - on) / off;
}

function aggregateObservedPairsForStratum(
  pairs: ObservedPairLike[],
): ObservedStratumAggregate {
  const totalPairs = pairs.length;
  const totalRetriesOff = pairs.reduce((sum, pair) => sum + pair.retriesOff, 0);
  const totalRetriesOn = pairs.reduce((sum, pair) => sum + pair.retriesOn, 0);
  const totalWallTimeOffMs = pairs.reduce((sum, pair) => sum + pair.wallTimeOffMs, 0);
  const totalWallTimeOnMs = pairs.reduce((sum, pair) => sum + pair.wallTimeOnMs, 0);
  const totalTokenCountOff = pairs.reduce((sum, pair) => sum + pair.tokenCountOff, 0);
  const totalTokenCountOn = pairs.reduce((sum, pair) => sum + pair.tokenCountOn, 0);
  const totalTokenProxyOff = pairs.reduce((sum, pair) => sum + pair.tokenProxyOff, 0);
  const totalTokenProxyOn = pairs.reduce((sum, pair) => sum + pair.tokenProxyOn, 0);
  const totalCostOffUsd = pairs.reduce((sum, pair) => sum + pair.costOffUsd, 0);
  const totalCostOnUsd = pairs.reduce((sum, pair) => sum + pair.costOnUsd, 0);

  const recoverySuccessCountOff = pairs.filter((pair) => pair.successOff).length;
  const recoverySuccessCountOn = pairs.filter((pair) => pair.successOn).length;

  const repeatedDeadEndRateOff = totalPairs === 0 ? 0 : totalRetriesOff / totalPairs;
  const repeatedDeadEndRateOn = totalPairs === 0 ? 0 : totalRetriesOn / totalPairs;
  const recoverySuccessRateOff =
    totalPairs === 0 ? 0 : recoverySuccessCountOff / totalPairs;
  const recoverySuccessRateOn =
    totalPairs === 0 ? 0 : recoverySuccessCountOn / totalPairs;

  return {
    totalPairs,
    totalRetriesOff,
    totalRetriesOn,
    repeatedDeadEndRateOff,
    repeatedDeadEndRateOn,
    recoverySuccessRateOff,
    recoverySuccessRateOn,
    totalWallTimeOffMs,
    totalWallTimeOnMs,
    totalTokenCountOff,
    totalTokenCountOn,
    totalTokenProxyOff,
    totalTokenProxyOn,
    totalCostOffUsd,
    totalCostOnUsd,
    relativeRepeatedDeadEndRateReduction: relativeReduction(
      totalRetriesOff,
      totalRetriesOn,
    ),
    relativeWallTimeReduction: relativeReduction(totalWallTimeOffMs, totalWallTimeOnMs),
    relativeTokenCountReduction: relativeReduction(
      totalTokenCountOff,
      totalTokenCountOn,
    ),
    relativeTokenProxyReduction: relativeReduction(
      totalTokenProxyOff,
      totalTokenProxyOn,
    ),
    absoluteRecoverySuccessRateDelta: recoverySuccessRateOn - recoverySuccessRateOff,
  };
}

function evaluateObservedGateForStratum(
  aggregate: ObservedStratumAggregate,
  thresholds: ObservedThresholdsLike,
): {
  pass: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  if (aggregate.totalPairs < thresholds.minPairCount) {
    failures.push(`pair count ${aggregate.totalPairs} < ${thresholds.minPairCount}`);
  }
  if (
    aggregate.relativeRepeatedDeadEndRateReduction <
    thresholds.minRelativeDeadEndReduction
  ) {
    failures.push(
      `repeated dead-end reduction ${aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3)} < ${thresholds.minRelativeDeadEndReduction.toFixed(3)}`,
    );
  }
  if (aggregate.relativeWallTimeReduction < thresholds.minRelativeWallTimeReduction) {
    failures.push(
      `wall-time reduction ${aggregate.relativeWallTimeReduction.toFixed(3)} < ${thresholds.minRelativeWallTimeReduction.toFixed(3)}`,
    );
  }
  if (
    aggregate.relativeTokenCountReduction < thresholds.minRelativeTokenCountReduction
  ) {
    failures.push(
      `token-count reduction ${aggregate.relativeTokenCountReduction.toFixed(3)} < ${thresholds.minRelativeTokenCountReduction.toFixed(3)}`,
    );
  }
  if (
    aggregate.relativeTokenProxyReduction < thresholds.minRelativeTokenProxyReduction
  ) {
    failures.push(
      `token-proxy reduction ${aggregate.relativeTokenProxyReduction.toFixed(3)} < ${thresholds.minRelativeTokenProxyReduction.toFixed(3)}`,
    );
  }
  if (aggregate.recoverySuccessRateOn < thresholds.minRecoverySuccessRateOn) {
    failures.push(
      `recovery success on ${aggregate.recoverySuccessRateOn.toFixed(3)} < ${thresholds.minRecoverySuccessRateOn.toFixed(3)}`,
    );
  }
  if (
    aggregate.absoluteRecoverySuccessRateDelta < -thresholds.maxRecoverySuccessRateDrop
  ) {
    failures.push(
      `recovery success drop ${(-aggregate.absoluteRecoverySuccessRateDelta).toFixed(3)} > ${thresholds.maxRecoverySuccessRateDrop.toFixed(3)}`,
    );
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

function sortStrata(strata: ObservedStratumSummary[]): ObservedStratumSummary[] {
  return [...strata].sort((left, right) => {
    if (right.pairCount !== left.pairCount) {
      return right.pairCount - left.pairCount;
    }
    if (right.episodeCount !== left.episodeCount) {
      return right.episodeCount - left.episodeCount;
    }
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
}

function buildObservedStrata(
  episodes: ObservedEpisodeLike[],
  pairs: ObservedPairLike[],
  sessionModelKeys: Map<string, string>,
  thresholds: ObservedThresholdsLike,
): ObservedStrata {
  const byDimension = {
    model: {
      episodeIds: new Map<string, Set<string>>(),
      sessionIds: new Map<string, Set<string>>(),
      pairs: new Map<string, ObservedPairLike[]>(),
    },
    toolSurface: {
      episodeIds: new Map<string, Set<string>>(),
      sessionIds: new Map<string, Set<string>>(),
      pairs: new Map<string, ObservedPairLike[]>(),
    },
    modelToolSurface: {
      episodeIds: new Map<string, Set<string>>(),
      sessionIds: new Map<string, Set<string>>(),
      pairs: new Map<string, ObservedPairLike[]>(),
    },
  };

  function addEpisodeKey(
    dimension: keyof ObservedStrata,
    key: string,
    episodeId: string,
    sessionId: string,
  ): void {
    const episodeSet = byDimension[dimension].episodeIds.get(key) ?? new Set<string>();
    episodeSet.add(episodeId);
    byDimension[dimension].episodeIds.set(key, episodeSet);

    const sessionSet = byDimension[dimension].sessionIds.get(key) ?? new Set<string>();
    sessionSet.add(sessionId);
    byDimension[dimension].sessionIds.set(key, sessionSet);
  }

  function addPairKey(
    dimension: keyof ObservedStrata,
    key: string,
    pair: ObservedPairLike,
  ): void {
    const pairList = byDimension[dimension].pairs.get(key) ?? [];
    pairList.push(pair);
    byDimension[dimension].pairs.set(key, pairList);
  }

  for (const episode of episodes) {
    const modelKey = sessionModelKeys.get(episode.sessionId) ?? "unknown";
    const toolSurfaceKey = inferToolSurfaceKey(episode.familySignature);
    const modelToolKey = `${modelKey}__${toolSurfaceKey}`;

    addEpisodeKey("model", modelKey, episode.id, episode.sessionId);
    addEpisodeKey("toolSurface", toolSurfaceKey, episode.id, episode.sessionId);
    addEpisodeKey("modelToolSurface", modelToolKey, episode.id, episode.sessionId);
  }

  for (const pair of pairs) {
    const modelKey = modelKeyForPair(
      pair.offSessionId,
      pair.onSessionId,
      sessionModelKeys,
    );
    const toolSurfaceKey = inferToolSurfaceKey(pair.familySignature);
    const modelToolKey = `${modelKey}__${toolSurfaceKey}`;

    addPairKey("model", modelKey, pair);
    addPairKey("toolSurface", toolSurfaceKey, pair);
    addPairKey("modelToolSurface", modelToolKey, pair);
  }

  function summarizeDimension(
    dimension: keyof ObservedStrata,
  ): ObservedStratumSummary[] {
    const keys = new Set<string>([
      ...byDimension[dimension].episodeIds.keys(),
      ...byDimension[dimension].pairs.keys(),
    ]);

    const summaries: ObservedStratumSummary[] = [];
    for (const key of keys) {
      const stratumPairs = byDimension[dimension].pairs.get(key) ?? [];
      const aggregate = aggregateObservedPairsForStratum(stratumPairs);
      const gateResult = evaluateObservedGateForStratum(aggregate, thresholds);
      const episodeIds =
        byDimension[dimension].episodeIds.get(key) ?? new Set<string>();
      const sessionIds =
        byDimension[dimension].sessionIds.get(key) ?? new Set<string>();

      summaries.push({
        key,
        pairCount: aggregate.totalPairs,
        episodeCount: episodeIds.size,
        sessionCount: sessionIds.size,
        aggregate,
        gateResult,
      });
    }

    return sortStrata(summaries);
  }

  return {
    model: summarizeDimension("model"),
    toolSurface: summarizeDimension("toolSurface"),
    modelToolSurface: summarizeDimension("modelToolSurface"),
  };
}

function isTraceEventRecord(record: JsonRecord): boolean {
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

function sessionHintFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() || "session";
  return fileName.replace(/\.jsonl$/i, "");
}

function sessionTraceFileLabel(traceFiles: Set<string>): string {
  const files = [...traceFiles].sort();
  if (files.length === 0) {
    return "";
  }
  if (files.length === 1) {
    return files[0] ?? "";
  }
  const first = files[0] ?? "";
  return `${first} (+${files.length - 1} more)`;
}

function toExitCode(
  options: ParsedOptions,
  familyOverlapCount: number,
  gatePass: boolean,
): number {
  let exitCode = 0;

  if (options.strictNoFamilyOverlap && familyOverlapCount > 0) {
    exitCode = 3;
  }

  if (options.strict && !gatePass) {
    exitCode = exitCode === 0 ? 2 : exitCode;
  }

  return exitCode;
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
    filterLongHorizonSessions,
    splitSessionsChronologically,
    summarizeFamilyOverlap,
    summarizeObservedAbSession,
  } = await import(pathToFileURL(distPath).href);

  const traceRoot = resolve(process.cwd(), options.traceRoot);
  const traceFiles = await collectJsonlFiles(traceRoot);
  if (traceFiles.length === 0) {
    throw new Error(`no .jsonl files found under ${traceRoot}`);
  }

  const sessionEnvelopes = new Map<string, SessionEnvelope>();
  let traceEventFilesScanned = 0;
  let piSessionFilesScanned = 0;
  let skippedForFormat = 0;

  for (const traceFile of traceFiles) {
    const raw = await readFile(traceFile, "utf-8");
    const records = parseJsonlRecords(raw);
    if (records.length === 0) {
      continue;
    }

    const sourceModelKey = detectModelKeyFromRecords(records);

    const traceEvents = records.filter(isTraceEventRecord);
    const shouldUseTraceFormat =
      options.format === "trace" ||
      (options.format === "auto" && traceEvents.length > 0);

    let events: Array<Record<string, unknown>> = [];
    if (shouldUseTraceFormat) {
      if (traceEvents.length === 0) {
        skippedForFormat += 1;
        continue;
      }
      traceEventFilesScanned += 1;
      events = traceEvents;
    } else {
      piSessionFilesScanned += 1;
      events = buildTraceEventsFromPiSessionRecords(records, {
        sessionId: sessionHintFromPath(traceFile),
        harness: options.harness,
        scope: options.scope,
        toolName: options.toolName,
      });
      if (events.length === 0) {
        continue;
      }
    }

    for (const event of events) {
      const sessionId =
        typeof event.sessionId === "string" && event.sessionId.length > 0
          ? event.sessionId
          : sessionHintFromPath(traceFile);

      const existing = sessionEnvelopes.get(sessionId);
      if (existing) {
        existing.events.push(event);
        existing.traceFiles.add(traceFile);
        existing.modelKeys.add(sourceModelKey);
        continue;
      }

      sessionEnvelopes.set(sessionId, {
        sessionId,
        events: [event],
        traceFiles: new Set([traceFile]),
        modelKeys: new Set([sourceModelKey]),
      });
    }
  }

  const sessionSummaries = [...sessionEnvelopes.values()].map((envelope) => {
    return summarizeObservedAbSession(
      envelope.sessionId,
      sessionTraceFileLabel(envelope.traceFiles),
      envelope.events,
    );
  });

  const sessionModelKeys = new Map<string, string>(
    [...sessionEnvelopes.values()].map((envelope) => {
      return [envelope.sessionId, resolveSessionModelKey(envelope.modelKeys)];
    }),
  );

  const longHorizonSessions = filterLongHorizonSessions(sessionSummaries, {
    minSessionDurationMs: options.minSessionDurationMs,
    minTotalLatencyMs: options.minTotalLatencyMs,
    minToolResultCount: options.minToolResultCount,
  });

  const holdout = splitSessionsChronologically(longHorizonSessions, options.evalRatio);
  const trainSessionIds = new Set(
    holdout.trainSessions.map((session) => session.sessionId),
  );
  const evalSessionIds = new Set(
    holdout.evalSessions.map((session) => session.sessionId),
  );

  const trainEvents = [...sessionEnvelopes.values()]
    .filter((envelope) => trainSessionIds.has(envelope.sessionId))
    .flatMap((envelope) => envelope.events);
  const evalEvents = [...sessionEnvelopes.values()]
    .filter((envelope) => evalSessionIds.has(envelope.sessionId))
    .flatMap((envelope) => envelope.events);

  const trainEpisodes = extractObservedAbEpisodes(trainEvents);
  const evalEpisodes = extractObservedAbEpisodes(evalEvents);
  const familyOverlap = summarizeFamilyOverlap(trainEpisodes, evalEpisodes);

  const observedReport = evaluateObservedAbGate(
    evalEpisodes,
    options.thresholds,
    {
      minOccurrencesPerFamily: options.pairing.minOccurrencesPerFamily,
      requireCrossSession: options.pairing.requireCrossSession,
      maxWallTimeRatio: options.pairing.maxWallTimeRatio,
      maxTokenCountRatio: options.pairing.maxTokenCountRatio,
    },
    {
      bootstrapSamples: options.trust.bootstrapSamples,
      confidenceLevel: options.trust.confidenceLevel,
      seed: options.trust.seed,
    },
  );

  const strata = buildObservedStrata(
    evalEpisodes as ObservedEpisodeLike[],
    observedReport.pairs as ObservedPairLike[],
    sessionModelKeys,
    observedReport.thresholds as ObservedThresholdsLike,
  );

  const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    traceRoot,
    format: options.format,
    toolName: options.toolName,
    files: {
      traceFilesFound: traceFiles.length,
      traceEventFilesScanned,
      piSessionFilesScanned,
      skippedForFormat,
    },
    holdout: {
      minSessionDurationMs: options.minSessionDurationMs,
      minTotalLatencyMs: options.minTotalLatencyMs,
      minToolResultCount: options.minToolResultCount,
      evalRatio: holdout.evalRatio,
      totalSessionsParsed: sessionSummaries.length,
      totalLongHorizonSessions: longHorizonSessions.length,
      trainSessionCount: holdout.trainSessions.length,
      evalSessionCount: holdout.evalSessions.length,
      familyOverlap,
    },
    trainEpisodeCount: trainEpisodes.length,
    evalEpisodeCount: evalEpisodes.length,
    thresholds: observedReport.thresholds,
    pairing: observedReport.pairing,
    pairingDiagnostics: observedReport.pairingDiagnostics,
    aggregate: observedReport.aggregate,
    trustSummary: observedReport.trustSummary,
    gateResult: observedReport.gateResult,
    strata,
  };

  const outPath = resolve(process.cwd(), options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Observed A/B long-horizon holdout benchmark");
    console.log(`- trace root: ${traceRoot}`);
    console.log(
      [
        "- files used:",
        `trace-events=${traceEventFilesScanned},`,
        `pi-sessions=${piSessionFilesScanned},`,
        `skipped=${skippedForFormat}`,
      ].join(" "),
    );
    console.log(
      [
        "- sessions:",
        `parsed=${sessionSummaries.length},`,
        `long_horizon=${longHorizonSessions.length},`,
        `train=${holdout.trainSessions.length},`,
        `eval=${holdout.evalSessions.length}`,
      ].join(" "),
    );
    console.log(
      [
        "- family overlap:",
        `${familyOverlap.overlappingFamilyCount} overlapping`,
        `(${(familyOverlap.overlapRateByEvalFamilies * 100).toFixed(1)}% of eval families)`,
      ].join(" "),
    );
    console.log(`- eval episodes: ${evalEpisodes.length}`);
    console.log(`- pairs: ${observedReport.aggregate.totalPairs}`);

    const topModelStratum = strata.model[0];
    if (topModelStratum) {
      console.log(
        [
          "- top model stratum:",
          `${topModelStratum.key}`,
          `(pairs=${topModelStratum.pairCount}, gate=${topModelStratum.gateResult.pass})`,
        ].join(" "),
      );
    }

    const topToolSurfaceStratum = strata.toolSurface[0];
    if (topToolSurfaceStratum) {
      console.log(
        [
          "- top tool-surface stratum:",
          `${topToolSurfaceStratum.key}`,
          `(pairs=${topToolSurfaceStratum.pairCount}, gate=${topToolSurfaceStratum.gateResult.pass})`,
        ].join(" "),
      );
    }

    console.log(
      [
        "- measured totals (OFF -> ON):",
        `${(observedReport.aggregate.totalWallTimeOffMs / 1000).toFixed(2)}s ->`,
        `${(observedReport.aggregate.totalWallTimeOnMs / 1000).toFixed(2)}s,`,
        `${observedReport.aggregate.totalTokenCountOff.toFixed(0)} ->`,
        `${observedReport.aggregate.totalTokenCountOn.toFixed(0)} tokens`,
      ].join(" "),
    );
    console.log(
      [
        "- deltas:",
        `dead_end=${observedReport.aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3)},`,
        `wall=${observedReport.aggregate.relativeWallTimeReduction.toFixed(3)},`,
        `tokens=${observedReport.aggregate.relativeTokenCountReduction.toFixed(3)}`,
      ].join(" "),
    );
    console.log(`- gate pass: ${observedReport.gateResult.pass}`);
    if (!observedReport.gateResult.pass) {
      console.log("- gate failures:");
      for (const failure of observedReport.gateResult.failures) {
        console.log(`  - ${failure}`);
      }
    }
    console.log(`- report json: ${outPath}`);
  }

  const exitCode = toExitCode(
    options,
    familyOverlap.overlappingFamilyCount,
    observedReport.gateResult.pass,
  );
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
