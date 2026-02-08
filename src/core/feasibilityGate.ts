import type { LearningLoop } from "./learningLoop.js";
import { type RunOutcome, deriveRunOutcomeFromEvents, tokenProxy } from "./metrics.js";
import type { TokenUsage } from "./types.js";
import {
  type WrongTurnScenario,
  type WrongTurnScenarioResult,
  runWrongTurnScenario,
} from "./wrongTurnEvaluation.js";

export interface FeasibilityThresholds {
  minRelativeDeadEndRateReduction?: number;
  minRelativeWallTimeReduction?: number;
  minRelativeTokenProxyReduction?: number;
  minRecoverySuccessRateOn?: number;
  maxRecoverySuccessRateDrop?: number;
}

export interface FeasibilityRetrievalSummary {
  totalScenarios: number;
  hitAt1Rate: number;
  hitAt3Rate: number;
  meanReciprocalRank: number;
  averageSuggestionLatencyMs: number;
}

export interface FeasibilityScenarioEstimate {
  scenarioId: string;
  description: string;
  rankOff: number | null;
  rankOn: number | null;
  hitAt3Off: boolean;
  hitAt3On: boolean;
  assistFactor: number;
  retriesOff: number;
  retriesOn: number;
  wallTimeOffMs: number;
  wallTimeOnMs: number;
  tokenProxyOff: number;
  tokenProxyOn: number;
  costOffUsd: number;
  costOnUsd: number;
  recoverySuccessOff: boolean;
  recoverySuccessOn: boolean;
}

export interface FeasibilityAggregate {
  totalScenarios: number;
  repeatedDeadEndRateOff: number;
  repeatedDeadEndRateOn: number;
  recoverySuccessRateOff: number;
  recoverySuccessRateOn: number;
  totalWallTimeOffMs: number;
  totalWallTimeOnMs: number;
  totalTokenProxyOff: number;
  totalTokenProxyOn: number;
  totalCostOffUsd: number;
  totalCostOnUsd: number;
  relativeRepeatedDeadEndRateReduction: number;
  relativeWallTimeReduction: number;
  relativeTokenProxyReduction: number;
  absoluteRecoverySuccessRateDelta: number;
}

export interface FeasibilityGateResult {
  pass: boolean;
  failures: string[];
}

export interface FeasibilityEvaluationReport {
  thresholds: Required<FeasibilityThresholds>;
  retrievalOff: FeasibilityRetrievalSummary;
  retrievalOn: FeasibilityRetrievalSummary;
  aggregate: FeasibilityAggregate;
  scenarioEstimates: FeasibilityScenarioEstimate[];
  gateResult: FeasibilityGateResult;
}

const DEFAULT_THRESHOLDS: Required<FeasibilityThresholds> = {
  minRelativeDeadEndRateReduction: 0.25,
  minRelativeWallTimeReduction: 0.1,
  minRelativeTokenProxyReduction: 0.1,
  minRecoverySuccessRateOn: 0.9,
  maxRecoverySuccessRateDrop: 0,
};

export function defaultFeasibilityThresholds(): Required<FeasibilityThresholds> {
  return { ...DEFAULT_THRESHOLDS };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function relativeReduction(off: number, on: number): number {
  if (off <= 0) {
    return on <= 0 ? 0 : -1;
  }
  return (off - on) / off;
}

function cloneTokenUsage(tokens: TokenUsage): TokenUsage {
  return {
    inputUncached: tokens.inputUncached ?? 0,
    inputCached: tokens.inputCached ?? 0,
    output: tokens.output ?? 0,
    thinking: tokens.thinking ?? 0,
    cacheWrite: tokens.cacheWrite ?? 0,
  };
}

function scaledTokenUsage(tokens: TokenUsage, factor: number): TokenUsage {
  const safeFactor = Math.max(0, factor);
  return {
    inputUncached: (tokens.inputUncached ?? 0) * safeFactor,
    inputCached: (tokens.inputCached ?? 0) * safeFactor,
    output: (tokens.output ?? 0) * safeFactor,
    thinking: (tokens.thinking ?? 0) * safeFactor,
    cacheWrite: (tokens.cacheWrite ?? 0) * safeFactor,
  };
}

function subtractTokenUsage(base: TokenUsage, reduction: TokenUsage): TokenUsage {
  return {
    inputUncached: toNonNegative(
      (base.inputUncached ?? 0) - (reduction.inputUncached ?? 0),
    ),
    inputCached: toNonNegative((base.inputCached ?? 0) - (reduction.inputCached ?? 0)),
    output: toNonNegative((base.output ?? 0) - (reduction.output ?? 0)),
    thinking: toNonNegative((base.thinking ?? 0) - (reduction.thinking ?? 0)),
    cacheWrite: toNonNegative((base.cacheWrite ?? 0) - (reduction.cacheWrite ?? 0)),
  };
}

function assistFactorFromRank(rank: number | null): number {
  if (rank === null) {
    return 0;
  }
  if (rank <= 1) {
    return 1;
  }
  if (rank === 2) {
    return 0.6;
  }
  if (rank === 3) {
    return 0.35;
  }
  return 0;
}

function normalizeThresholds(
  thresholds?: FeasibilityThresholds,
): Required<FeasibilityThresholds> {
  return {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };
}

function summarizeRetrieval(
  results: WrongTurnScenarioResult[],
): FeasibilityRetrievalSummary {
  const totalScenarios = results.length;
  const hitAt1Count = results.filter((result) => result.hitAt1).length;
  const hitAt3Count = results.filter((result) => result.hitAt3).length;

  return {
    totalScenarios,
    hitAt1Rate: totalScenarios === 0 ? 0 : hitAt1Count / totalScenarios,
    hitAt3Rate: totalScenarios === 0 ? 0 : hitAt3Count / totalScenarios,
    meanReciprocalRank: average(results.map((result) => result.reciprocalRank)),
    averageSuggestionLatencyMs: average(
      results.map((result) => result.suggestionLatencyMs),
    ),
  };
}

function estimateHappyPathOutcome(
  baseline: RunOutcome,
  failureOverhead: RunOutcome,
  options: {
    assistFactor: number;
    retrievalHit: boolean;
  },
): RunOutcome {
  const assistFactor = options.assistFactor;
  const retrievalHit = options.retrievalHit;

  const reducedFailureTokens = scaledTokenUsage(failureOverhead.tokens, assistFactor);
  const estimatedTokens = subtractTokenUsage(
    cloneTokenUsage(baseline.tokens),
    reducedFailureTokens,
  );

  const retriesToRemove =
    baseline.retries <= 0 || assistFactor <= 0
      ? 0
      : Math.max(1, Math.ceil(baseline.retries * assistFactor));

  return {
    wallTimeMs: toNonNegative(
      baseline.wallTimeMs - failureOverhead.wallTimeMs * assistFactor,
    ),
    success: baseline.success || retrievalHit,
    retries: Math.max(0, baseline.retries - retriesToRemove),
    costUsd: toNonNegative(baseline.costUsd - failureOverhead.costUsd * assistFactor),
    tokens: estimatedTokens,
  };
}

function evaluateThresholds(
  aggregate: FeasibilityAggregate,
  thresholds: Required<FeasibilityThresholds>,
): FeasibilityGateResult {
  const failures: string[] = [];

  if (
    aggregate.relativeRepeatedDeadEndRateReduction <
    thresholds.minRelativeDeadEndRateReduction
  ) {
    failures.push(
      [
        "repeated dead-end reduction",
        aggregate.relativeRepeatedDeadEndRateReduction.toFixed(3),
        "<",
        thresholds.minRelativeDeadEndRateReduction.toFixed(3),
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

export async function evaluateFeasibilityGate(
  scenarios: WrongTurnScenario[],
  createLoop: () => LearningLoop,
  thresholds?: FeasibilityThresholds,
): Promise<FeasibilityEvaluationReport> {
  const offResults: WrongTurnScenarioResult[] = [];
  const onResults: WrongTurnScenarioResult[] = [];
  const estimates: FeasibilityScenarioEstimate[] = [];

  for (const scenario of scenarios) {
    const offLoop = createLoop();
    const offScenario: WrongTurnScenario = {
      ...scenario,
      captureEvents: [],
    };
    const offResult = await runWrongTurnScenario(offLoop, offScenario);

    const onLoop = createLoop();
    const onResult = await runWrongTurnScenario(onLoop, scenario);

    offResults.push(offResult);
    onResults.push(onResult);

    const baselineOutcome = deriveRunOutcomeFromEvents(scenario.captureEvents);
    const failureEvents = scenario.captureEvents.filter((event) => {
      return event.metrics?.outcome === "failure";
    });
    const failureOverhead = deriveRunOutcomeFromEvents(failureEvents);

    const assistFactor = assistFactorFromRank(onResult.rank);
    const estimatedOutcome = estimateHappyPathOutcome(
      baselineOutcome,
      failureOverhead,
      {
        assistFactor,
        retrievalHit: onResult.hitAt3,
      },
    );

    estimates.push({
      scenarioId: scenario.id,
      description: scenario.description,
      rankOff: offResult.rank,
      rankOn: onResult.rank,
      hitAt3Off: offResult.hitAt3,
      hitAt3On: onResult.hitAt3,
      assistFactor,
      retriesOff: baselineOutcome.retries,
      retriesOn: estimatedOutcome.retries,
      wallTimeOffMs: baselineOutcome.wallTimeMs,
      wallTimeOnMs: estimatedOutcome.wallTimeMs,
      tokenProxyOff: tokenProxy(baselineOutcome.tokens),
      tokenProxyOn: tokenProxy(estimatedOutcome.tokens),
      costOffUsd: baselineOutcome.costUsd,
      costOnUsd: estimatedOutcome.costUsd,
      recoverySuccessOff: baselineOutcome.success,
      recoverySuccessOn: estimatedOutcome.success,
    });
  }

  const totalScenarios = estimates.length;
  const repeatedDeadEndRateOff =
    totalScenarios === 0
      ? 0
      : estimates.filter((entry) => entry.retriesOff > 0).length / totalScenarios;
  const repeatedDeadEndRateOn =
    totalScenarios === 0
      ? 0
      : estimates.filter((entry) => entry.retriesOn > 0).length / totalScenarios;

  const recoverySuccessRateOff =
    totalScenarios === 0
      ? 0
      : estimates.filter((entry) => entry.recoverySuccessOff).length / totalScenarios;
  const recoverySuccessRateOn =
    totalScenarios === 0
      ? 0
      : estimates.filter((entry) => entry.recoverySuccessOn).length / totalScenarios;

  const totalWallTimeOffMs = estimates.reduce(
    (sum, entry) => sum + entry.wallTimeOffMs,
    0,
  );
  const totalWallTimeOnMs = estimates.reduce(
    (sum, entry) => sum + entry.wallTimeOnMs,
    0,
  );
  const totalTokenProxyOff = estimates.reduce(
    (sum, entry) => sum + entry.tokenProxyOff,
    0,
  );
  const totalTokenProxyOn = estimates.reduce(
    (sum, entry) => sum + entry.tokenProxyOn,
    0,
  );
  const totalCostOffUsd = estimates.reduce((sum, entry) => sum + entry.costOffUsd, 0);
  const totalCostOnUsd = estimates.reduce((sum, entry) => sum + entry.costOnUsd, 0);

  const aggregate: FeasibilityAggregate = {
    totalScenarios,
    repeatedDeadEndRateOff,
    repeatedDeadEndRateOn,
    recoverySuccessRateOff,
    recoverySuccessRateOn,
    totalWallTimeOffMs,
    totalWallTimeOnMs,
    totalTokenProxyOff,
    totalTokenProxyOn,
    totalCostOffUsd,
    totalCostOnUsd,
    relativeRepeatedDeadEndRateReduction: relativeReduction(
      repeatedDeadEndRateOff,
      repeatedDeadEndRateOn,
    ),
    relativeWallTimeReduction: relativeReduction(totalWallTimeOffMs, totalWallTimeOnMs),
    relativeTokenProxyReduction: relativeReduction(
      totalTokenProxyOff,
      totalTokenProxyOn,
    ),
    absoluteRecoverySuccessRateDelta: recoverySuccessRateOn - recoverySuccessRateOff,
  };

  const normalizedThresholds = normalizeThresholds(thresholds);
  const gateResult = evaluateThresholds(aggregate, normalizedThresholds);

  return {
    thresholds: normalizedThresholds,
    retrievalOff: summarizeRetrieval(offResults),
    retrievalOn: summarizeRetrieval(onResults),
    aggregate,
    scenarioEstimates: estimates,
    gateResult,
  };
}
