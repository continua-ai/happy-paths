import { describe, expect, it } from "vitest";
import {
  type CanaryPolicy,
  assignPathVersion,
  decideCanaryAction,
} from "../src/core/pathLifecycle.js";

const DEFAULT_POLICY: CanaryPolicy = {
  hashAttribute: "actorId",
  canaryPercent: 20,
  minSamplesForDecision: 20,
  promoteIfSuccessRateAtLeast: 0.75,
  rollbackIfFailureRateAtLeast: 0.4,
};

describe("path lifecycle canary assignment", () => {
  it("routes consistently for the same actor/session", () => {
    const first = assignPathVersion(
      {
        actorId: "actor-1",
        sessionId: "session-1",
      },
      {
        stableVersionId: "stable-v1",
        canaryVersionId: "canary-v2",
        policy: DEFAULT_POLICY,
      },
    );

    const second = assignPathVersion(
      {
        actorId: "actor-1",
        sessionId: "session-99",
      },
      {
        stableVersionId: "stable-v1",
        canaryVersionId: "canary-v2",
        policy: DEFAULT_POLICY,
      },
    );

    expect(first.route).toBe(second.route);
    expect(first.hashBucket).toBe(second.hashBucket);
  });

  it("falls back to stable when canary is disabled", () => {
    const result = assignPathVersion(
      {
        actorId: "actor-2",
        sessionId: "session-2",
      },
      {
        stableVersionId: "stable-v1",
      },
    );

    expect(result.route).toBe("stable");
    expect(result.selectedVersionId).toBe("stable-v1");
    expect(result.reason).toBe("canary_disabled");
  });
});

describe("path lifecycle canary decisions", () => {
  it("holds when sample size is too small", () => {
    const decision = decideCanaryAction(
      {
        stable: { sampleSize: 100, successCount: 82 },
        canary: { sampleSize: 8, successCount: 7 },
      },
      DEFAULT_POLICY,
    );

    expect(decision.action).toBe("hold");
    expect(decision.reason).toContain("insufficient_samples");
  });

  it("promotes when canary clears success threshold", () => {
    const decision = decideCanaryAction(
      {
        stable: { sampleSize: 200, successCount: 160 },
        canary: { sampleSize: 40, successCount: 33 },
      },
      DEFAULT_POLICY,
    );

    expect(decision.action).toBe("promote");
  });

  it("rolls back when canary failure rate is too high", () => {
    const decision = decideCanaryAction(
      {
        stable: { sampleSize: 200, successCount: 160 },
        canary: { sampleSize: 40, successCount: 18 },
      },
      DEFAULT_POLICY,
    );

    expect(decision.action).toBe("rollback");
  });
});
