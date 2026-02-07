import type { TraceScope } from "./types.js";

export type PathLifecycleStage =
  | "draft"
  | "canary"
  | "stable"
  | "deprecated"
  | "archived";

export interface PathPerformanceSummary {
  sampleSize: number;
  successRate: number;
  averageWallTimeMs: number;
  averageCostUsd: number;
  averageTokenProxy: number;
}

export interface HappyPathVersion {
  id: string;
  pathId: string;
  stage: PathLifecycleStage;
  createdAt: string;
  summary: string;
  playbookMarkdown: string;
  tags?: string[];
  performance?: PathPerformanceSummary;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface HappyPathArtifact {
  id: string;
  title: string;
  scope: TraceScope;
  ownerActorId?: string;
  createdAt: string;
  updatedAt: string;
  versions: HappyPathVersion[];
}

export interface CanaryPolicy {
  hashAttribute: "actorId" | "sessionId" | "agentId";
  canaryPercent: number;
  minSamplesForDecision: number;
  promoteIfSuccessRateAtLeast: number;
  rollbackIfFailureRateAtLeast: number;
}

export interface CanaryAssignmentRequest {
  actorId?: string;
  sessionId: string;
  agentId?: string;
}

export interface CanaryAssignmentResult {
  route: "stable" | "canary";
  stableVersionId: string;
  canaryVersionId?: string;
  selectedVersionId: string;
  hashBucket: number;
  reason: string;
}

export interface CanaryPerformanceWindow {
  stable: {
    sampleSize: number;
    successCount: number;
  };
  canary: {
    sampleSize: number;
    successCount: number;
  };
}

export interface CanaryDecision {
  action: "hold" | "promote" | "rollback";
  reason: string;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function assignmentKey(
  request: CanaryAssignmentRequest,
  hashAttribute: CanaryPolicy["hashAttribute"],
): string {
  if (hashAttribute === "actorId") {
    return request.actorId || request.sessionId;
  }
  if (hashAttribute === "agentId") {
    return request.agentId || request.sessionId;
  }
  return request.sessionId;
}

export function assignPathVersion(
  request: CanaryAssignmentRequest,
  options: {
    stableVersionId: string;
    canaryVersionId?: string;
    policy?: CanaryPolicy;
  },
): CanaryAssignmentResult {
  const stableVersionId = options.stableVersionId;
  const canaryVersionId = options.canaryVersionId;
  const policy = options.policy;

  if (!canaryVersionId || !policy) {
    return {
      route: "stable",
      stableVersionId,
      selectedVersionId: stableVersionId,
      hashBucket: -1,
      reason: "canary_disabled",
    };
  }

  const key = assignmentKey(request, policy.hashAttribute);
  const hashBucket = fnv1a32(key) % 100;
  const canaryPercent = clampPercent(policy.canaryPercent);

  if (hashBucket < canaryPercent) {
    return {
      route: "canary",
      stableVersionId,
      canaryVersionId,
      selectedVersionId: canaryVersionId,
      hashBucket,
      reason: `bucket_${hashBucket}_lt_${canaryPercent}`,
    };
  }

  return {
    route: "stable",
    stableVersionId,
    canaryVersionId,
    selectedVersionId: stableVersionId,
    hashBucket,
    reason: `bucket_${hashBucket}_gte_${canaryPercent}`,
  };
}

function successRate(sampleSize: number, successCount: number): number {
  if (sampleSize <= 0) {
    return 0;
  }
  return successCount / sampleSize;
}

export function decideCanaryAction(
  window: CanaryPerformanceWindow,
  policy: CanaryPolicy,
): CanaryDecision {
  const canarySamples = window.canary.sampleSize;
  if (canarySamples < policy.minSamplesForDecision) {
    return {
      action: "hold",
      reason: `insufficient_samples_${canarySamples}_lt_${policy.minSamplesForDecision}`,
    };
  }

  const canarySuccessRate = successRate(
    window.canary.sampleSize,
    window.canary.successCount,
  );
  const canaryFailureRate = 1 - canarySuccessRate;

  if (canaryFailureRate >= policy.rollbackIfFailureRateAtLeast) {
    return {
      action: "rollback",
      reason: `failure_rate_${canaryFailureRate.toFixed(3)}_gte_${policy.rollbackIfFailureRateAtLeast.toFixed(3)}`,
    };
  }

  if (canarySuccessRate >= policy.promoteIfSuccessRateAtLeast) {
    return {
      action: "promote",
      reason: `success_rate_${canarySuccessRate.toFixed(3)}_gte_${policy.promoteIfSuccessRateAtLeast.toFixed(3)}`,
    };
  }

  return {
    action: "hold",
    reason: `success_rate_${canarySuccessRate.toFixed(3)}_below_${policy.promoteIfSuccessRateAtLeast.toFixed(3)}`,
  };
}
