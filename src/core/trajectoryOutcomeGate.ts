import type { RunOutcome } from "./metrics.js";
import { deriveRunOutcomeFromEvents, tokenProxy } from "./metrics.js";
import {
  extractErrorSignatures,
  normalizeCommandSignature,
  normalizeText,
} from "./signatures.js";
import type { TraceEvent } from "./types.js";

export type TrajectoryIssueKind =
  | "benign_probe"
  | "transient_external"
  | "command_mismatch"
  | "environment_mismatch"
  | "missing_context"
  | "unknown_failure";

export interface TrajectoryIssue {
  eventId: string;
  kind: TrajectoryIssueKind;
  harmful: boolean;
  confidence: number;
  reason: string;
}

export interface TrajectoryEpisodeIssueSummary {
  totalFailures: number;
  harmfulFailures: number;
  benignProbeFailures: number;
  transientExternalFailures: number;
  commandMismatchFailures: number;
  environmentMismatchFailures: number;
  missingContextFailures: number;
  unknownFailures: number;
  judgeableFailures: number;
  abstainedFailures: number;
}

export interface TrajectoryOutcomeThresholds {
  minPairCount?: number;
  minRelativeHarmfulRetryReduction?: number;
  minRelativeWallTimeReduction?: number;
  minRelativeTokenCountReduction?: number;
  minRecoverySuccessRateOn?: number;
  maxRecoverySuccessRateDrop?: number;
  minJudgeableCoverage?: number;
}

export interface TrajectoryOutcomePairingOptions {
  minOccurrencesPerFamily?: number;
  requireCrossSession?: boolean;
  maxWallTimeRatio?: number;
  maxTokenCountRatio?: number;
}

export interface TrajectoryOutcomeTrustOptions {
  bootstrapSamples?: number;
  confidenceLevel?: number;
  seed?: number;
}

export interface TrajectoryOutcomeEpisode {
  id: string;
  familySignature: string;
  description: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  outcome: RunOutcome;
  tokenCount: number;
  tokenProxy: number;
  issues: TrajectoryIssue[];
  issueSummary: TrajectoryEpisodeIssueSummary;
}

export interface TrajectoryOutcomePair {
  id: string;
  familySignature: string;
  description: string;
  offEpisodeId: string;
  onEpisodeId: string;
  offSessionId: string;
  onSessionId: string;
  offStartedAt: string;
  onStartedAt: string;
  totalRetriesOff: number;
  totalRetriesOn: number;
  harmfulRetriesOff: number;
  harmfulRetriesOn: number;
  benignRetriesOff: number;
  benignRetriesOn: number;
  abstainedRetriesOff: number;
  abstainedRetriesOn: number;
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

export interface TrajectoryOutcomeAggregate {
  totalPairs: number;
  totalRetriesOff: number;
  totalRetriesOn: number;
  totalHarmfulRetriesOff: number;
  totalHarmfulRetriesOn: number;
  totalBenignRetriesOff: number;
  totalBenignRetriesOn: number;
  totalAbstainedRetriesOff: number;
  totalAbstainedRetriesOn: number;
  harmfulRetryRateOff: number;
  harmfulRetryRateOn: number;
  judgeableCoverageOff: number;
  judgeableCoverageOn: number;
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
  relativeHarmfulRetryReduction: number;
  relativeWallTimeReduction: number;
  relativeTokenCountReduction: number;
  relativeTokenProxyReduction: number;
  absoluteRecoverySuccessRateDelta: number;
}

export interface TrajectoryOutcomeInterval {
  low: number;
  median: number;
  high: number;
}

export interface TrajectoryOutcomeTrustSummary {
  method: "paired_bootstrap";
  sampleCount: number;
  confidenceLevel: number;
  harmfulRetryReduction: TrajectoryOutcomeInterval;
  wallTimeReduction: TrajectoryOutcomeInterval;
  tokenCountReduction: TrajectoryOutcomeInterval;
  tokenProxyReduction: TrajectoryOutcomeInterval;
  expectedHarmfulRetriesAvoided: TrajectoryOutcomeInterval;
}

export interface TrajectoryOutcomeGateResult {
  pass: boolean;
  failures: string[];
}

export interface TrajectoryOutcomePairingDiagnostics {
  familiesSeen: number;
  familiesEligible: number;
  candidateTransitions: number;
  droppedSameSession: number;
  droppedOutlierRatio: number;
  pairsBuilt: number;
}

export interface TrajectoryOutcomeReport {
  thresholds: Required<TrajectoryOutcomeThresholds>;
  pairing: Required<TrajectoryOutcomePairingOptions>;
  pairingDiagnostics: TrajectoryOutcomePairingDiagnostics;
  episodes: TrajectoryOutcomeEpisode[];
  pairs: TrajectoryOutcomePair[];
  aggregate: TrajectoryOutcomeAggregate;
  trustSummary: TrajectoryOutcomeTrustSummary;
  gateResult: TrajectoryOutcomeGateResult;
}

const DEFAULT_THRESHOLDS: Required<TrajectoryOutcomeThresholds> = {
  minPairCount: 3,
  minRelativeHarmfulRetryReduction: 0.2,
  minRelativeWallTimeReduction: 0.1,
  minRelativeTokenCountReduction: 0.1,
  minRecoverySuccessRateOn: 0.9,
  maxRecoverySuccessRateDrop: 0,
  minJudgeableCoverage: 0.6,
};

const DEFAULT_PAIRING: Required<TrajectoryOutcomePairingOptions> = {
  minOccurrencesPerFamily: 2,
  requireCrossSession: true,
  maxWallTimeRatio: 4,
  maxTokenCountRatio: 4,
};

const DEFAULT_TRUST_OPTIONS: Required<TrajectoryOutcomeTrustOptions> = {
  bootstrapSamples: 2000,
  confidenceLevel: 0.95,
  seed: 31,
};

const PROBE_COMMAND_PATTERN =
  /\b(curl|wget|http|fetch|rg|ripgrep|grep|find|ls|stat|test)\b/i;

const PROBE_FAILURE_PATTERN =
  /(\b404\b|not found|no matches? found|no result|cannot access .*no such file or directory|does not exist|command exited with code 1)/i;

const TRANSIENT_EXTERNAL_PATTERN =
  /(timed out|timeout|connection reset|connection refused|temporarily unavailable|rate limit|429\b|\b50[234]\b|network is unreachable|tls handshake timeout|upstream)/i;

const COMMAND_MISMATCH_PATTERN =
  /(unknown option|unrecognized option|invalid option|invalid argument|usage:\s|did you mean .*--)/i;

const ENVIRONMENT_MISMATCH_PATTERN =
  /(permission denied|command not found|executable file not found|cannot find module|module not found|no such file or directory|missing dependency|denied by policy)/i;

const MISSING_CONTEXT_PATTERN =
  /(undefined variable|is not defined|cannot read properties of undefined|null pointer|keyerror|attributeerror|typeerror)/i;

function normalizeThresholds(
  thresholds?: TrajectoryOutcomeThresholds,
): Required<TrajectoryOutcomeThresholds> {
  return {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };
}

function normalizePairing(
  options?: TrajectoryOutcomePairingOptions,
): Required<TrajectoryOutcomePairingOptions> {
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
  options?: TrajectoryOutcomeTrustOptions,
): Required<TrajectoryOutcomeTrustOptions> {
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

function asClassifiedIssue(
  event: TraceEvent,
  kind: TrajectoryIssueKind,
  harmful: boolean,
  confidence: number,
  reason: string,
): TrajectoryIssue {
  return {
    eventId: event.id,
    kind,
    harmful,
    confidence,
    reason,
  };
}

function isLikelyProbeCommand(command: string): boolean {
  return PROBE_COMMAND_PATTERN.test(command);
}

function isLikelyProbeFailure(command: string, output: string): boolean {
  if (!isLikelyProbeCommand(command)) {
    return false;
  }

  return PROBE_FAILURE_PATTERN.test(output);
}

export function classifyTrajectoryIssue(event: TraceEvent): TrajectoryIssue | null {
  if (!isFailure(event)) {
    return null;
  }

  const command = commandFromPayload(event);
  const output = textFromPayload(event);
  const normalizedCommand = normalizeText(command);
  const normalizedOutput = normalizeText(output);
  const combined = `${normalizedCommand}\n${normalizedOutput}`;

  if (TRANSIENT_EXTERNAL_PATTERN.test(combined)) {
    return asClassifiedIssue(
      event,
      "transient_external",
      false,
      0.84,
      "Transient external dependency failure (timeout/network/rate limit).",
    );
  }

  if (isLikelyProbeFailure(normalizedCommand, normalizedOutput)) {
    return asClassifiedIssue(
      event,
      "benign_probe",
      false,
      0.82,
      "Likely exploratory probe failure (expected uncertainty).",
    );
  }

  if (COMMAND_MISMATCH_PATTERN.test(combined)) {
    return asClassifiedIssue(
      event,
      "command_mismatch",
      true,
      0.9,
      "Command/options mismatch likely avoidable with prior context.",
    );
  }

  if (ENVIRONMENT_MISMATCH_PATTERN.test(combined)) {
    return asClassifiedIssue(
      event,
      "environment_mismatch",
      true,
      0.86,
      "Environment/dependency mismatch likely avoidable with recovered fix path.",
    );
  }

  if (MISSING_CONTEXT_PATTERN.test(combined)) {
    return asClassifiedIssue(
      event,
      "missing_context",
      true,
      0.78,
      "Likely missing context/state for this step.",
    );
  }

  return asClassifiedIssue(
    event,
    "unknown_failure",
    false,
    0.35,
    "Abstain: insufficient confidence to classify failure as harmful or benign.",
  );
}

function summarizeEpisodeIssues(
  issues: TrajectoryIssue[],
): TrajectoryEpisodeIssueSummary {
  let harmfulFailures = 0;
  let benignProbeFailures = 0;
  let transientExternalFailures = 0;
  let commandMismatchFailures = 0;
  let environmentMismatchFailures = 0;
  let missingContextFailures = 0;
  let unknownFailures = 0;

  for (const issue of issues) {
    if (issue.harmful) {
      harmfulFailures += 1;
    }

    switch (issue.kind) {
      case "benign_probe":
        benignProbeFailures += 1;
        break;
      case "transient_external":
        transientExternalFailures += 1;
        break;
      case "command_mismatch":
        commandMismatchFailures += 1;
        break;
      case "environment_mismatch":
        environmentMismatchFailures += 1;
        break;
      case "missing_context":
        missingContextFailures += 1;
        break;
      case "unknown_failure":
        unknownFailures += 1;
        break;
      default:
        break;
    }
  }

  const totalFailures = issues.length;
  const abstainedFailures = unknownFailures;

  return {
    totalFailures,
    harmfulFailures,
    benignProbeFailures,
    transientExternalFailures,
    commandMismatchFailures,
    environmentMismatchFailures,
    missingContextFailures,
    unknownFailures,
    judgeableFailures: Math.max(0, totalFailures - abstainedFailures),
    abstainedFailures,
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

function compareEpisodeTime(
  left: TrajectoryOutcomeEpisode,
  right: TrajectoryOutcomeEpisode,
): number {
  if (left.startedAt < right.startedAt) {
    return -1;
  }
  if (left.startedAt > right.startedAt) {
    return 1;
  }
  return 0;
}

export function extractTrajectoryOutcomeEpisodes(
  events: TraceEvent[],
): TrajectoryOutcomeEpisode[] {
  const bySession = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const sessionEvents = bySession.get(event.sessionId);
    if (sessionEvents) {
      sessionEvents.push(event);
      continue;
    }
    bySession.set(event.sessionId, [event]);
  }

  const episodes: TrajectoryOutcomeEpisode[] = [];

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

      const issues: TrajectoryIssue[] = [];
      for (const episodeEvent of episodeEvents) {
        const issue = classifyTrajectoryIssue(episodeEvent);
        if (issue) {
          issues.push(issue);
        }
      }

      const issueSummary = summarizeEpisodeIssues(issues);
      const outcome = deriveRunOutcomeFromEvents(episodeEvents);
      const tokenCount = totalTokenCount(outcome);

      episodes.push({
        id: `${sessionId}-trajectory-episode-${episodes.length + 1}`,
        familySignature: familySignature(failureEvent),
        description: episodeDescription(failureEvent),
        sessionId,
        startedAt: failureEvent.timestamp,
        endedAt: successEvent.timestamp,
        outcome,
        tokenCount,
        tokenProxy: tokenProxy(outcome.tokens),
        issues,
        issueSummary,
      });

      index = successIndex;
    }
  }

  return episodes.sort(compareEpisodeTime);
}

function buildPairsWithDiagnostics(
  episodes: TrajectoryOutcomeEpisode[],
  options?: TrajectoryOutcomePairingOptions,
): {
  pairs: TrajectoryOutcomePair[];
  diagnostics: TrajectoryOutcomePairingDiagnostics;
} {
  const pairing = normalizePairing(options);
  const byFamily = new Map<string, TrajectoryOutcomeEpisode[]>();

  for (const episode of episodes) {
    const familyEpisodes = byFamily.get(episode.familySignature);
    if (familyEpisodes) {
      familyEpisodes.push(episode);
      continue;
    }
    byFamily.set(episode.familySignature, [episode]);
  }

  const diagnostics: TrajectoryOutcomePairingDiagnostics = {
    familiesSeen: byFamily.size,
    familiesEligible: 0,
    candidateTransitions: 0,
    droppedSameSession: 0,
    droppedOutlierRatio: 0,
    pairsBuilt: 0,
  };

  const pairs: TrajectoryOutcomePair[] = [];

  for (const [familySignatureValue, familyEpisodes] of byFamily.entries()) {
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
        id: `${familySignatureValue}-trajectory-pair-${pairs.length + 1}`,
        familySignature: familySignatureValue,
        description: off.description,
        offEpisodeId: off.id,
        onEpisodeId: on.id,
        offSessionId: off.sessionId,
        onSessionId: on.sessionId,
        offStartedAt: off.startedAt,
        onStartedAt: on.startedAt,
        totalRetriesOff: off.outcome.retries,
        totalRetriesOn: on.outcome.retries,
        harmfulRetriesOff: off.issueSummary.harmfulFailures,
        harmfulRetriesOn: on.issueSummary.harmfulFailures,
        benignRetriesOff:
          off.issueSummary.benignProbeFailures +
          off.issueSummary.transientExternalFailures,
        benignRetriesOn:
          on.issueSummary.benignProbeFailures +
          on.issueSummary.transientExternalFailures,
        abstainedRetriesOff: off.issueSummary.abstainedFailures,
        abstainedRetriesOn: on.issueSummary.abstainedFailures,
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

export function buildTrajectoryOutcomePairs(
  episodes: TrajectoryOutcomeEpisode[],
  options?: TrajectoryOutcomePairingOptions,
): TrajectoryOutcomePair[] {
  return buildPairsWithDiagnostics(episodes, options).pairs;
}

function aggregatePairs(pairs: TrajectoryOutcomePair[]): TrajectoryOutcomeAggregate {
  const totalPairs = pairs.length;
  const totalRetriesOff = pairs.reduce((sum, pair) => sum + pair.totalRetriesOff, 0);
  const totalRetriesOn = pairs.reduce((sum, pair) => sum + pair.totalRetriesOn, 0);
  const totalHarmfulRetriesOff = pairs.reduce(
    (sum, pair) => sum + pair.harmfulRetriesOff,
    0,
  );
  const totalHarmfulRetriesOn = pairs.reduce(
    (sum, pair) => sum + pair.harmfulRetriesOn,
    0,
  );
  const totalBenignRetriesOff = pairs.reduce(
    (sum, pair) => sum + pair.benignRetriesOff,
    0,
  );
  const totalBenignRetriesOn = pairs.reduce(
    (sum, pair) => sum + pair.benignRetriesOn,
    0,
  );
  const totalAbstainedRetriesOff = pairs.reduce(
    (sum, pair) => sum + pair.abstainedRetriesOff,
    0,
  );
  const totalAbstainedRetriesOn = pairs.reduce(
    (sum, pair) => sum + pair.abstainedRetriesOn,
    0,
  );

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

  const harmfulRetryRateOff =
    totalPairs === 0 ? 0 : totalHarmfulRetriesOff / totalPairs;
  const harmfulRetryRateOn = totalPairs === 0 ? 0 : totalHarmfulRetriesOn / totalPairs;

  const recoverySuccessRateOff =
    totalPairs === 0 ? 0 : recoverySuccessCountOff / totalPairs;
  const recoverySuccessRateOn =
    totalPairs === 0 ? 0 : recoverySuccessCountOn / totalPairs;

  const judgeableRetriesOff = Math.max(0, totalRetriesOff - totalAbstainedRetriesOff);
  const judgeableRetriesOn = Math.max(0, totalRetriesOn - totalAbstainedRetriesOn);

  const judgeableCoverageOff =
    totalRetriesOff <= 0 ? 1 : judgeableRetriesOff / totalRetriesOff;
  const judgeableCoverageOn =
    totalRetriesOn <= 0 ? 1 : judgeableRetriesOn / totalRetriesOn;

  return {
    totalPairs,
    totalRetriesOff,
    totalRetriesOn,
    totalHarmfulRetriesOff,
    totalHarmfulRetriesOn,
    totalBenignRetriesOff,
    totalBenignRetriesOn,
    totalAbstainedRetriesOff,
    totalAbstainedRetriesOn,
    harmfulRetryRateOff,
    harmfulRetryRateOn,
    judgeableCoverageOff,
    judgeableCoverageOn,
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
    relativeHarmfulRetryReduction: relativeReduction(
      totalHarmfulRetriesOff,
      totalHarmfulRetriesOn,
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
  aggregate: TrajectoryOutcomeAggregate,
  thresholds: Required<TrajectoryOutcomeThresholds>,
): TrajectoryOutcomeGateResult {
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
    aggregate.relativeHarmfulRetryReduction <
    thresholds.minRelativeHarmfulRetryReduction
  ) {
    failures.push(
      [
        "harmful retry reduction",
        aggregate.relativeHarmfulRetryReduction.toFixed(3),
        "<",
        thresholds.minRelativeHarmfulRetryReduction.toFixed(3),
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

  if (aggregate.judgeableCoverageOff < thresholds.minJudgeableCoverage) {
    failures.push(
      [
        "judgeable coverage off",
        aggregate.judgeableCoverageOff.toFixed(3),
        "<",
        thresholds.minJudgeableCoverage.toFixed(3),
      ].join(" "),
    );
  }

  if (aggregate.judgeableCoverageOn < thresholds.minJudgeableCoverage) {
    failures.push(
      [
        "judgeable coverage on",
        aggregate.judgeableCoverageOn.toFixed(3),
        "<",
        thresholds.minJudgeableCoverage.toFixed(3),
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

function hashPairs(pairs: TrajectoryOutcomePair[]): number {
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

function interval(
  values: number[],
  confidenceLevel: number,
): TrajectoryOutcomeInterval {
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
  pairs: TrajectoryOutcomePair[],
  options?: TrajectoryOutcomeTrustOptions,
): TrajectoryOutcomeTrustSummary {
  const normalizedOptions = normalizeTrustOptions(options);

  if (pairs.length === 0) {
    const zero = { low: 0, median: 0, high: 0 };
    return {
      method: "paired_bootstrap",
      sampleCount: normalizedOptions.bootstrapSamples,
      confidenceLevel: normalizedOptions.confidenceLevel,
      harmfulRetryReduction: zero,
      wallTimeReduction: zero,
      tokenCountReduction: zero,
      tokenProxyReduction: zero,
      expectedHarmfulRetriesAvoided: zero,
    };
  }

  const random = createPrng(normalizedOptions.seed ^ hashPairs(pairs));

  const harmfulRetrySamples: number[] = [];
  const wallTimeSamples: number[] = [];
  const tokenCountSamples: number[] = [];
  const tokenProxySamples: number[] = [];
  const avoidedHarmfulRetriesSamples: number[] = [];

  for (let sample = 0; sample < normalizedOptions.bootstrapSamples; sample += 1) {
    const sampled: TrajectoryOutcomePair[] = [];
    for (let index = 0; index < pairs.length; index += 1) {
      const randomIndex = Math.floor(random() * pairs.length);
      const pair = pairs[randomIndex];
      if (!pair) {
        continue;
      }
      sampled.push(pair);
    }

    const aggregate = aggregatePairs(sampled);
    harmfulRetrySamples.push(aggregate.relativeHarmfulRetryReduction);
    wallTimeSamples.push(aggregate.relativeWallTimeReduction);
    tokenCountSamples.push(aggregate.relativeTokenCountReduction);
    tokenProxySamples.push(aggregate.relativeTokenProxyReduction);
    avoidedHarmfulRetriesSamples.push(
      aggregate.totalHarmfulRetriesOff - aggregate.totalHarmfulRetriesOn,
    );
  }

  return {
    method: "paired_bootstrap",
    sampleCount: normalizedOptions.bootstrapSamples,
    confidenceLevel: normalizedOptions.confidenceLevel,
    harmfulRetryReduction: interval(
      harmfulRetrySamples,
      normalizedOptions.confidenceLevel,
    ),
    wallTimeReduction: interval(wallTimeSamples, normalizedOptions.confidenceLevel),
    tokenCountReduction: interval(tokenCountSamples, normalizedOptions.confidenceLevel),
    tokenProxyReduction: interval(tokenProxySamples, normalizedOptions.confidenceLevel),
    expectedHarmfulRetriesAvoided: interval(
      avoidedHarmfulRetriesSamples,
      normalizedOptions.confidenceLevel,
    ),
  };
}

export function evaluateTrajectoryOutcomeGate(
  episodes: TrajectoryOutcomeEpisode[],
  thresholds?: TrajectoryOutcomeThresholds,
  pairingOptions?: TrajectoryOutcomePairingOptions,
  trustOptions?: TrajectoryOutcomeTrustOptions,
): TrajectoryOutcomeReport {
  const normalizedThresholds = normalizeThresholds(thresholds);
  const normalizedPairing = normalizePairing(pairingOptions);
  const pairingResult = buildPairsWithDiagnostics(episodes, normalizedPairing);
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
