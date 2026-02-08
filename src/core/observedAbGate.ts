import type { RunOutcome } from "./metrics.js";
import { deriveRunOutcomeFromEvents, tokenProxy } from "./metrics.js";
import {
  extractErrorSignatures,
  normalizeCommandSignature,
  normalizeText,
} from "./signatures.js";
import type { TraceEvent } from "./types.js";

export interface ObservedAbThresholds {
  minPairCount?: number;
  minRelativeDeadEndReduction?: number;
  minRelativeWallTimeReduction?: number;
  minRelativeTokenCountReduction?: number;
  minRelativeTokenProxyReduction?: number;
  minRecoverySuccessRateOn?: number;
  maxRecoverySuccessRateDrop?: number;
}

export interface ObservedAbPairingOptions {
  minOccurrencesPerFamily?: number;
  requireCrossSession?: boolean;
  maxWallTimeRatio?: number;
  maxTokenCountRatio?: number;
}

export interface ObservedAbTrustOptions {
  bootstrapSamples?: number;
  confidenceLevel?: number;
  seed?: number;
}

export interface ObservedAbEpisode {
  id: string;
  familySignature: string;
  description: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  outcome: RunOutcome;
  tokenCount: number;
  tokenProxy: number;
}

export interface ObservedAbPair {
  id: string;
  familySignature: string;
  description: string;
  offEpisodeId: string;
  onEpisodeId: string;
  offSessionId: string;
  onSessionId: string;
  offStartedAt: string;
  onStartedAt: string;
  retriesOff: number;
  retriesOn: number;
  wallTimeOffMs: number;
  wallTimeOnMs: number;
  wallTimeRatio: number;
  tokenCountOff: number;
  tokenCountOn: number;
  tokenCountRatio: number;
  tokenProxyOff: number;
  tokenProxyOn: number;
  costOffUsd: number;
  costOnUsd: number;
  successOff: boolean;
  successOn: boolean;
  qualityScore: number;
}

export interface ObservedAbAggregate {
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
}

export interface ObservedAbInterval {
  low: number;
  median: number;
  high: number;
}

export interface ObservedAbTrustSummary {
  method: "paired_bootstrap";
  sampleCount: number;
  confidenceLevel: number;
  deadEndReduction: ObservedAbInterval;
  wallTimeReduction: ObservedAbInterval;
  tokenCountReduction: ObservedAbInterval;
  tokenProxyReduction: ObservedAbInterval;
  expectedDeadEndsAvoided: ObservedAbInterval;
}

export interface ObservedAbGateResult {
  pass: boolean;
  failures: string[];
}

export interface ObservedAbPairingDiagnostics {
  familiesSeen: number;
  familiesEligible: number;
  candidateTransitions: number;
  droppedSameSession: number;
  droppedOutlierRatio: number;
  pairsBuilt: number;
}

export interface ObservedAbReport {
  thresholds: Required<ObservedAbThresholds>;
  pairing: Required<ObservedAbPairingOptions>;
  pairingDiagnostics: ObservedAbPairingDiagnostics;
  episodes: ObservedAbEpisode[];
  pairs: ObservedAbPair[];
  aggregate: ObservedAbAggregate;
  trustSummary: ObservedAbTrustSummary;
  gateResult: ObservedAbGateResult;
}

const DEFAULT_THRESHOLDS: Required<ObservedAbThresholds> = {
  minPairCount: 3,
  minRelativeDeadEndReduction: 0.25,
  minRelativeWallTimeReduction: 0.1,
  minRelativeTokenCountReduction: 0.1,
  minRelativeTokenProxyReduction: 0.1,
  minRecoverySuccessRateOn: 0.9,
  maxRecoverySuccessRateDrop: 0,
};

const DEFAULT_PAIRING: Required<ObservedAbPairingOptions> = {
  minOccurrencesPerFamily: 2,
  requireCrossSession: true,
  maxWallTimeRatio: 4,
  maxTokenCountRatio: 4,
};

const DEFAULT_TRUST_OPTIONS: Required<ObservedAbTrustOptions> = {
  bootstrapSamples: 2000,
  confidenceLevel: 0.95,
  seed: 31,
};

function normalizeThresholds(
  thresholds?: ObservedAbThresholds,
): Required<ObservedAbThresholds> {
  return {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };
}

function normalizePairing(
  options?: ObservedAbPairingOptions,
): Required<ObservedAbPairingOptions> {
  const minOccurrencesPerFamily = Number.isFinite(options?.minOccurrencesPerFamily)
    ? Math.max(2, Math.floor(options?.minOccurrencesPerFamily ?? 2))
    : DEFAULT_PAIRING.minOccurrencesPerFamily;

  const maxWallTimeRatio = Number.isFinite(options?.maxWallTimeRatio)
    ? Math.max(1, options?.maxWallTimeRatio ?? 4)
    : DEFAULT_PAIRING.maxWallTimeRatio;

  const maxTokenCountRatio = Number.isFinite(options?.maxTokenCountRatio)
    ? Math.max(1, options?.maxTokenCountRatio ?? 4)
    : DEFAULT_PAIRING.maxTokenCountRatio;

  return {
    ...DEFAULT_PAIRING,
    ...options,
    minOccurrencesPerFamily,
    maxWallTimeRatio,
    maxTokenCountRatio,
  };
}

function normalizeTrustOptions(
  options?: ObservedAbTrustOptions,
): Required<ObservedAbTrustOptions> {
  const bootstrapSamples = Number.isFinite(options?.bootstrapSamples)
    ? Math.max(200, Math.floor(options?.bootstrapSamples ?? 0))
    : DEFAULT_TRUST_OPTIONS.bootstrapSamples;

  const confidenceLevel = Number.isFinite(options?.confidenceLevel)
    ? Math.max(0.5, Math.min(0.999, options?.confidenceLevel ?? 0.95))
    : DEFAULT_TRUST_OPTIONS.confidenceLevel;

  const seed = Number.isFinite(options?.seed)
    ? Math.floor(options?.seed ?? DEFAULT_TRUST_OPTIONS.seed)
    : DEFAULT_TRUST_OPTIONS.seed;

  return {
    bootstrapSamples,
    confidenceLevel,
    seed,
  };
}

function relativeReduction(off: number, on: number): number {
  if (off <= 0) {
    return on <= 0 ? 0 : -1;
  }
  return (off - on) / off;
}

function totalTokenCount(outcome: RunOutcome): number {
  const tokens = outcome.tokens;
  return (
    (tokens.inputUncached ?? 0) +
    (tokens.inputCached ?? 0) +
    (tokens.output ?? 0) +
    (tokens.thinking ?? 0) +
    (tokens.cacheWrite ?? 0)
  );
}

function isFailure(event: TraceEvent): boolean {
  if (event.type !== "tool_result") {
    return false;
  }
  if (event.metrics?.outcome === "failure") {
    return true;
  }
  return event.payload?.isError === true;
}

function isSuccess(event: TraceEvent): boolean {
  if (event.type !== "tool_result") {
    return false;
  }
  if (event.metrics?.outcome === "success") {
    return true;
  }
  return event.payload?.isError === false;
}

function commandFromPayload(event: TraceEvent): string {
  const command = event.payload?.command;
  return typeof command === "string" ? command : "";
}

function textFromPayload(event: TraceEvent): string {
  const text = event.payload?.text;
  if (typeof text === "string" && text.trim()) {
    return text;
  }

  const output = event.payload?.output;
  if (typeof output === "string" && output.trim()) {
    return output;
  }

  return "";
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function familySignature(failure: TraceEvent): string {
  const command = normalizeCommandSignature(commandFromPayload(failure));
  const output = textFromPayload(failure);
  const firstError = extractErrorSignatures(output, 1)[0] ?? "";

  const signature = normalizeText(`${command} ${firstError}`).slice(0, 240);
  if (signature) {
    return signature;
  }

  return normalizeText(firstLine(output) || command || "recovery").slice(0, 240);
}

function episodeDescription(failure: TraceEvent): string {
  const text = textFromPayload(failure);
  const summary = firstLine(text) || commandFromPayload(failure) || "recovery";
  return `Recover from ${summary}`;
}

function sortEventsChronologically(events: TraceEvent[]): TraceEvent[] {
  return [...events].sort((left, right) => {
    if (left.timestamp < right.timestamp) {
      return -1;
    }
    if (left.timestamp > right.timestamp) {
      return 1;
    }
    return 0;
  });
}

function aggregatePairs(pairs: ObservedAbPair[]): ObservedAbAggregate {
  const totalPairs = pairs.length;
  const totalRetriesOff = pairs.reduce((sum, pair) => sum + pair.retriesOff, 0);
  const totalRetriesOn = pairs.reduce((sum, pair) => sum + pair.retriesOn, 0);

  const recoverySuccessCountOff = pairs.filter((pair) => pair.successOff).length;
  const recoverySuccessCountOn = pairs.filter((pair) => pair.successOn).length;

  const totalWallTimeOffMs = pairs.reduce((sum, pair) => sum + pair.wallTimeOffMs, 0);
  const totalWallTimeOnMs = pairs.reduce((sum, pair) => sum + pair.wallTimeOnMs, 0);

  const totalTokenCountOff = pairs.reduce((sum, pair) => sum + pair.tokenCountOff, 0);
  const totalTokenCountOn = pairs.reduce((sum, pair) => sum + pair.tokenCountOn, 0);

  const totalTokenProxyOff = pairs.reduce((sum, pair) => sum + pair.tokenProxyOff, 0);
  const totalTokenProxyOn = pairs.reduce((sum, pair) => sum + pair.tokenProxyOn, 0);

  const totalCostOffUsd = pairs.reduce((sum, pair) => sum + pair.costOffUsd, 0);
  const totalCostOnUsd = pairs.reduce((sum, pair) => sum + pair.costOnUsd, 0);

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

function evaluateGate(
  aggregate: ObservedAbAggregate,
  thresholds: Required<ObservedAbThresholds>,
): ObservedAbGateResult {
  const failures: string[] = [];

  if (aggregate.totalPairs < thresholds.minPairCount) {
    failures.push(
      [
        "pair count",
        aggregate.totalPairs.toString(),
        "<",
        thresholds.minPairCount,
      ].join(" "),
    );
  }

  if (
    aggregate.relativeRepeatedDeadEndRateReduction <
    thresholds.minRelativeDeadEndReduction
  ) {
    failures.push(
      [
        "repeated dead-end reduction",
        aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3),
        "<",
        thresholds.minRelativeDeadEndReduction.toFixed(3),
      ].join(" "),
    );
  }

  if (aggregate.relativeWallTimeReduction < thresholds.minRelativeWallTimeReduction) {
    failures.push(
      [
        "wall-time reduction",
        aggregate.relativeWallTimeReduction.toFixed(3),
        "<",
        thresholds.minRelativeWallTimeReduction.toFixed(3),
      ].join(" "),
    );
  }

  if (
    aggregate.relativeTokenCountReduction < thresholds.minRelativeTokenCountReduction
  ) {
    failures.push(
      [
        "token-count reduction",
        aggregate.relativeTokenCountReduction.toFixed(3),
        "<",
        thresholds.minRelativeTokenCountReduction.toFixed(3),
      ].join(" "),
    );
  }

  if (
    aggregate.relativeTokenProxyReduction < thresholds.minRelativeTokenProxyReduction
  ) {
    failures.push(
      [
        "token-proxy reduction",
        aggregate.relativeTokenProxyReduction.toFixed(3),
        "<",
        thresholds.minRelativeTokenProxyReduction.toFixed(3),
      ].join(" "),
    );
  }

  if (aggregate.recoverySuccessRateOn < thresholds.minRecoverySuccessRateOn) {
    failures.push(
      [
        "recovery success on",
        aggregate.recoverySuccessRateOn.toFixed(3),
        "<",
        thresholds.minRecoverySuccessRateOn.toFixed(3),
      ].join(" "),
    );
  }

  const successDrop =
    aggregate.recoverySuccessRateOff - aggregate.recoverySuccessRateOn;
  if (successDrop > thresholds.maxRecoverySuccessRateDrop) {
    failures.push(
      [
        "recovery success drop",
        successDrop.toFixed(3),
        ">",
        thresholds.maxRecoverySuccessRateDrop.toFixed(3),
      ].join(" "),
    );
  }

  return {
    pass: failures.length === 0,
    failures,
  };
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

function hashPairs(pairs: ObservedAbPair[]): number {
  let hash = 2166136261;
  for (const pair of pairs) {
    const key = `${pair.id}|${pair.offEpisodeId}|${pair.onEpisodeId}`;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }
  if (values.length === 1) {
    return values[0] ?? 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;

  if (lower === upper) {
    return lowerValue;
  }

  const fraction = position - lower;
  return lowerValue + (upperValue - lowerValue) * fraction;
}

function interval(values: number[], confidenceLevel: number): ObservedAbInterval {
  if (values.length === 0) {
    return {
      low: 0,
      median: 0,
      high: 0,
    };
  }

  const tail = (1 - confidenceLevel) / 2;
  return {
    low: quantile(values, tail),
    median: quantile(values, 0.5),
    high: quantile(values, 1 - tail),
  };
}

function summarizeTrust(
  pairs: ObservedAbPair[],
  options?: ObservedAbTrustOptions,
): ObservedAbTrustSummary {
  const normalizedOptions = normalizeTrustOptions(options);

  if (pairs.length === 0) {
    const zero = { low: 0, median: 0, high: 0 };
    return {
      method: "paired_bootstrap",
      sampleCount: normalizedOptions.bootstrapSamples,
      confidenceLevel: normalizedOptions.confidenceLevel,
      deadEndReduction: zero,
      wallTimeReduction: zero,
      tokenCountReduction: zero,
      tokenProxyReduction: zero,
      expectedDeadEndsAvoided: zero,
    };
  }

  const random = createPrng(normalizedOptions.seed ^ hashPairs(pairs));

  const deadEndSamples: number[] = [];
  const wallTimeSamples: number[] = [];
  const tokenCountSamples: number[] = [];
  const tokenProxySamples: number[] = [];
  const avoidedDeadEndsSamples: number[] = [];

  for (let sample = 0; sample < normalizedOptions.bootstrapSamples; sample += 1) {
    const sampled: ObservedAbPair[] = [];
    for (let index = 0; index < pairs.length; index += 1) {
      const randomIndex = Math.floor(random() * pairs.length);
      const pair = pairs[randomIndex];
      if (!pair) {
        continue;
      }
      sampled.push(pair);
    }

    const aggregate = aggregatePairs(sampled);
    deadEndSamples.push(aggregate.relativeRepeatedDeadEndRateReduction);
    wallTimeSamples.push(aggregate.relativeWallTimeReduction);
    tokenCountSamples.push(aggregate.relativeTokenCountReduction);
    tokenProxySamples.push(aggregate.relativeTokenProxyReduction);
    avoidedDeadEndsSamples.push(aggregate.totalRetriesOff - aggregate.totalRetriesOn);
  }

  return {
    method: "paired_bootstrap",
    sampleCount: normalizedOptions.bootstrapSamples,
    confidenceLevel: normalizedOptions.confidenceLevel,
    deadEndReduction: interval(deadEndSamples, normalizedOptions.confidenceLevel),
    wallTimeReduction: interval(wallTimeSamples, normalizedOptions.confidenceLevel),
    tokenCountReduction: interval(tokenCountSamples, normalizedOptions.confidenceLevel),
    tokenProxyReduction: interval(tokenProxySamples, normalizedOptions.confidenceLevel),
    expectedDeadEndsAvoided: interval(
      avoidedDeadEndsSamples,
      normalizedOptions.confidenceLevel,
    ),
  };
}

function positiveRatio(left: number, right: number): number {
  if (left === 0 && right === 0) {
    return 1;
  }

  if (left <= 0 || right <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const max = Math.max(left, right);
  const min = Math.min(left, right);
  return max / min;
}

function pairQualityScore(wallTimeRatio: number, tokenCountRatio: number): number {
  if (!Number.isFinite(wallTimeRatio) || !Number.isFinite(tokenCountRatio)) {
    return 0;
  }

  const wallPenalty = Math.abs(Math.log2(wallTimeRatio));
  const tokenPenalty = Math.abs(Math.log2(tokenCountRatio));
  return 1 / (1 + wallPenalty + tokenPenalty);
}

function compareEpisodeTime(left: ObservedAbEpisode, right: ObservedAbEpisode): number {
  if (left.startedAt < right.startedAt) {
    return -1;
  }
  if (left.startedAt > right.startedAt) {
    return 1;
  }
  return 0;
}

export function extractObservedAbEpisodes(events: TraceEvent[]): ObservedAbEpisode[] {
  const bySession = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const sessionEvents = bySession.get(event.sessionId);
    if (sessionEvents) {
      sessionEvents.push(event);
      continue;
    }
    bySession.set(event.sessionId, [event]);
  }

  const episodes: ObservedAbEpisode[] = [];

  for (const [sessionId, sessionEvents] of bySession.entries()) {
    const sorted = sortEventsChronologically(sessionEvents);

    for (let index = 0; index < sorted.length; index += 1) {
      const failureEvent = sorted[index];
      if (!failureEvent || !isFailure(failureEvent)) {
        continue;
      }

      let successIndex = -1;
      for (let probe = index + 1; probe < sorted.length; probe += 1) {
        const candidate = sorted[probe];
        if (candidate && isSuccess(candidate)) {
          successIndex = probe;
          break;
        }
      }

      if (successIndex < 0) {
        continue;
      }

      const episodeEvents = sorted.slice(index, successIndex + 1);
      const successEvent = sorted[successIndex];
      if (!successEvent) {
        continue;
      }

      const outcome = deriveRunOutcomeFromEvents(episodeEvents);
      const tokenCount = totalTokenCount(outcome);
      const family = familySignature(failureEvent);

      episodes.push({
        id: `${sessionId}-episode-${episodes.length + 1}`,
        familySignature: family,
        description: episodeDescription(failureEvent),
        sessionId,
        startedAt: failureEvent.timestamp,
        endedAt: successEvent.timestamp,
        outcome,
        tokenCount,
        tokenProxy: tokenProxy(outcome.tokens),
      });

      index = successIndex;
    }
  }

  return episodes.sort(compareEpisodeTime);
}

function buildObservedAbPairsWithDiagnostics(
  episodes: ObservedAbEpisode[],
  options?: ObservedAbPairingOptions,
): { pairs: ObservedAbPair[]; diagnostics: ObservedAbPairingDiagnostics } {
  const pairing = normalizePairing(options);
  const byFamily = new Map<string, ObservedAbEpisode[]>();

  for (const episode of episodes) {
    const familyEpisodes = byFamily.get(episode.familySignature);
    if (familyEpisodes) {
      familyEpisodes.push(episode);
      continue;
    }
    byFamily.set(episode.familySignature, [episode]);
  }

  const diagnostics: ObservedAbPairingDiagnostics = {
    familiesSeen: byFamily.size,
    familiesEligible: 0,
    candidateTransitions: 0,
    droppedSameSession: 0,
    droppedOutlierRatio: 0,
    pairsBuilt: 0,
  };

  const pairs: ObservedAbPair[] = [];

  for (const [familySignature, familyEpisodes] of byFamily.entries()) {
    if (familyEpisodes.length < pairing.minOccurrencesPerFamily) {
      continue;
    }

    diagnostics.familiesEligible += 1;

    const sorted = [...familyEpisodes].sort(compareEpisodeTime);

    for (let index = 1; index < sorted.length; index += 1) {
      const off = sorted[index - 1];
      const on = sorted[index];
      if (!off || !on) {
        continue;
      }

      diagnostics.candidateTransitions += 1;

      if (pairing.requireCrossSession && off.sessionId === on.sessionId) {
        diagnostics.droppedSameSession += 1;
        continue;
      }

      const wallTimeRatio = positiveRatio(
        off.outcome.wallTimeMs,
        on.outcome.wallTimeMs,
      );
      const tokenCountRatio = positiveRatio(off.tokenCount, on.tokenCount);

      if (
        wallTimeRatio > pairing.maxWallTimeRatio ||
        tokenCountRatio > pairing.maxTokenCountRatio
      ) {
        diagnostics.droppedOutlierRatio += 1;
        continue;
      }

      pairs.push({
        id: `${familySignature}-pair-${pairs.length + 1}`,
        familySignature,
        description: off.description,
        offEpisodeId: off.id,
        onEpisodeId: on.id,
        offSessionId: off.sessionId,
        onSessionId: on.sessionId,
        offStartedAt: off.startedAt,
        onStartedAt: on.startedAt,
        retriesOff: off.outcome.retries,
        retriesOn: on.outcome.retries,
        wallTimeOffMs: off.outcome.wallTimeMs,
        wallTimeOnMs: on.outcome.wallTimeMs,
        wallTimeRatio,
        tokenCountOff: off.tokenCount,
        tokenCountOn: on.tokenCount,
        tokenCountRatio,
        tokenProxyOff: off.tokenProxy,
        tokenProxyOn: on.tokenProxy,
        costOffUsd: off.outcome.costUsd,
        costOnUsd: on.outcome.costUsd,
        successOff: off.outcome.success,
        successOn: on.outcome.success,
        qualityScore: pairQualityScore(wallTimeRatio, tokenCountRatio),
      });
    }
  }

  const sortedPairs = pairs.sort((left, right) => {
    if (left.onStartedAt < right.onStartedAt) {
      return -1;
    }
    if (left.onStartedAt > right.onStartedAt) {
      return 1;
    }
    return 0;
  });

  diagnostics.pairsBuilt = sortedPairs.length;

  return {
    pairs: sortedPairs,
    diagnostics,
  };
}

export function buildObservedAbPairs(
  episodes: ObservedAbEpisode[],
  options?: ObservedAbPairingOptions,
): ObservedAbPair[] {
  return buildObservedAbPairsWithDiagnostics(episodes, options).pairs;
}

export function evaluateObservedAbGate(
  episodes: ObservedAbEpisode[],
  thresholds?: ObservedAbThresholds,
  pairingOptions?: ObservedAbPairingOptions,
  trustOptions?: ObservedAbTrustOptions,
): ObservedAbReport {
  const normalizedThresholds = normalizeThresholds(thresholds);
  const normalizedPairing = normalizePairing(pairingOptions);
  const pairingResult = buildObservedAbPairsWithDiagnostics(
    episodes,
    normalizedPairing,
  );
  const aggregate = aggregatePairs(pairingResult.pairs);
  const trustSummary = summarizeTrust(pairingResult.pairs, trustOptions);
  const gateResult = evaluateGate(aggregate, normalizedThresholds);

  return {
    thresholds: normalizedThresholds,
    pairing: normalizedPairing,
    pairingDiagnostics: pairingResult.diagnostics,
    episodes,
    pairs: pairingResult.pairs,
    aggregate,
    trustSummary,
    gateResult,
  };
}
