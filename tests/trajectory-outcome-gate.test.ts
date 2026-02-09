import { describe, expect, it } from "vitest";
import {
  classifyTrajectoryIssue,
  evaluateTrajectoryOutcomeGate,
  extractTrajectoryOutcomeEpisodes,
} from "../src/core/trajectoryOutcomeGate.js";
import type { TraceEvent } from "../src/core/types.js";

function event(
  input: Partial<TraceEvent> & {
    type: TraceEvent["type"];
    payload: Record<string, unknown>;
  },
): TraceEvent {
  return {
    id: input.id ?? "event-id",
    timestamp: input.timestamp ?? "2026-03-01T00:00:00.000Z",
    sessionId: input.sessionId ?? "session-1",
    harness: input.harness ?? "pi",
    scope: input.scope ?? "personal",
    type: input.type,
    payload: input.payload,
    metrics: input.metrics,
    agentId: input.agentId,
    actorId: input.actorId,
    tags: input.tags,
  };
}

describe("trajectory outcome gate", () => {
  it("classifies likely probe failures as benign", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "probe-failure",
        type: "tool_result",
        payload: {
          command: "curl -sS https://docs.example.com/does-not-exist",
          output: "HTTP/2 404 Not Found\nCommand exited with code 1",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("benign_probe");
    expect(issue?.harmful).toBe(false);
  });

  it("classifies eval gate failures as benign probes", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "eval-gate-failure",
        type: "tool_result",
        payload: {
          command: "npm run eval:observed-ab",
          output:
            "Observed A/B gate summary\n- gate pass: false\n- gate failures:\n  - pair count 0 < 3",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("benign_probe");
    expect(issue?.harmful).toBe(false);
  });

  it("classifies gh pr checks with no checks reported as benign probes", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "gh-no-checks",
        type: "tool_result",
        payload: {
          command: "gh pr checks 123",
          output: "no checks reported on the 'my-branch' branch",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("benign_probe");
    expect(issue?.harmful).toBe(false);
  });

  it("classifies invalid option failures as command mismatch", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "bad-flag",
        type: "tool_result",
        payload: {
          command: "npm run lint -- --badflag",
          output: "error: unknown option '--badflag'",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("command_mismatch");
    expect(issue?.harmful).toBe(true);
  });

  it("treats empty probe outputs as benign", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "empty-probe",
        type: "tool_result",
        payload: {
          command: 'curl -sS https://example.com | rg -n "missing"',
          output: "",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("benign_probe");
    expect(issue?.harmful).toBe(false);
  });

  it("treats jq parse errors during probes as benign", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "jq-parse-error",
        type: "tool_result",
        payload: {
          command: "curl -sS https://example.com/api | jq -c .",
          output: "jq: parse error: Invalid numeric literal at line 1, column 2",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("benign_probe");
    expect(issue?.harmful).toBe(false);
  });

  it("classifies gh template misuse as command mismatch", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "gh-template-misuse",
        type: "tool_result",
        payload: {
          command: "gh pr view 123 --template '{{.title}}'",
          output: "cannot use `--template` without specifying `--json`",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("command_mismatch");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies reauthentication blocks as missing context", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "gcloud-reauth",
        type: "tool_result",
        payload: {
          command: "gcloud auth print-access-token",
          output:
            "ERROR: (gcloud.auth.print-access-token) There was a problem refreshing your current auth tokens: Reauthentication failed. Cannot prompt during non-interactive execution.",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("missing_context");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies ERR_MODULE_NOT_FOUND as environment mismatch", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "node-err-module-not-found",
        type: "tool_result",
        payload: {
          command: "node --check /tmp/script.mjs",
          output:
            "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright' imported from /tmp/script.mjs",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("environment_mismatch");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies generic python tracebacks as missing context", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "python-traceback",
        type: "tool_result",
        payload: {
          command: "python3 /tmp/example.py",
          output: "Traceback (most recent call last):",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("missing_context");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies biome check failures as missing context", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "biome-check",
        type: "tool_result",
        payload: {
          command: "biome check .",
          output: "× Some errors were emitted while running checks.",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("missing_context");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies empty non-probe failures as environment mismatch", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "empty-non-probe",
        type: "tool_result",
        payload: {
          command: "cd /tmp && npm run verify",
          output: "",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("environment_mismatch");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies policy-required flag errors as command mismatch", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "missing-condition-flag",
        type: "tool_result",
        payload: {
          command:
            "gcloud projects add-iam-policy-binding example-project --member='serviceAccount:test' --role='roles/viewer' --quiet",
          output:
            "ERROR: (gcloud.projects.add-iam-policy-binding) Adding a binding without specifying a condition to a policy containing conditions is prohibited in non-interactive mode. Run the command again with --condition.",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("command_mismatch");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies merge policy blocks as missing context", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "merge-policy-blocked",
        type: "tool_result",
        payload: {
          command: "gh pr merge 9 --repo continua-ai/happy-paths --squash",
          output:
            "X Pull request continua-ai/happy-paths#9 is not mergeable: the base branch policy prohibits the merge.",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("missing_context");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies API auth failures as missing context", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "search-console-403",
        type: "tool_result",
        payload: {
          command:
            "python3 scripts/search_console_report.py --site sc-domain:happypaths.dev",
          output:
            'GET https://searchconsole.googleapis.com/webmasters/v3/sites failed: HTTP 403 {"error":{"status":"PERMISSION_DENIED"}}',
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("missing_context");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies vertex traceback failures as transient external", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "vertex-traceback",
        type: "tool_result",
        payload: {
          command:
            "gcloud auth print-access-token >/tmp/token && python3 /tmp/generate_vertex_image.py --model gemini-2.5-flash-image",
          output: "Traceback (most recent call last):\nHTTP Error 401: Unauthorized",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("transient_external");
    expect(issue?.harmful).toBe(false);
  });

  it("classifies repo-path misses as missing context", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "missing-github-dir",
        type: "tool_result",
        payload: {
          command:
            "cd /Users/dpetrou/src/happy-paths-web && find .github -maxdepth 3 -type f -name '*.yml'",
          output: "find: .github: No such file or directory",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("missing_context");
    expect(issue?.harmful).toBe(true);
  });

  it("classifies externally managed pip failures as environment mismatch", () => {
    const issue = classifyTrajectoryIssue(
      event({
        id: "pip-managed-env",
        type: "tool_result",
        payload: {
          command: "python3 -m pip install --quiet pypdf",
          output: "error: externally-managed-environment",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
    );

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("environment_mismatch");
    expect(issue?.harmful).toBe(true);
  });

  it("measures harmful retry reductions across paired episodes", () => {
    const events: TraceEvent[] = [
      event({
        id: "a-f1",
        sessionId: "session-a",
        timestamp: "2026-03-01T00:00:01.000Z",
        type: "tool_result",
        payload: {
          command: "npm run lint -- --badflag",
          output: "error: unknown option '--badflag'",
          isError: true,
        },
        metrics: {
          outcome: "failure",
          latencyMs: 4_000,
          tokens: {
            inputUncached: 120,
            output: 20,
          },
        },
      }),
      event({
        id: "a-f2",
        sessionId: "session-a",
        timestamp: "2026-03-01T00:00:08.000Z",
        type: "tool_result",
        payload: {
          command: "npm run lint -- --badflag",
          output: "error: unknown option '--badflag'",
          isError: true,
        },
        metrics: {
          outcome: "failure",
          latencyMs: 3_000,
          tokens: {
            inputUncached: 110,
            output: 15,
          },
        },
      }),
      event({
        id: "a-s1",
        sessionId: "session-a",
        timestamp: "2026-03-01T00:00:13.000Z",
        type: "tool_result",
        payload: {
          command: "npm run lint --fix",
          output: "ok",
          isError: false,
        },
        metrics: {
          outcome: "success",
          latencyMs: 2_000,
          tokens: {
            inputUncached: 80,
            output: 15,
          },
        },
      }),
      event({
        id: "b-f1",
        sessionId: "session-b",
        timestamp: "2026-03-02T00:00:01.000Z",
        type: "tool_result",
        payload: {
          command: "npm run lint -- --badflag",
          output: "error: unknown option '--badflag'",
          isError: true,
        },
        metrics: {
          outcome: "failure",
          latencyMs: 1_000,
          tokens: {
            inputUncached: 90,
            output: 10,
          },
        },
      }),
      event({
        id: "b-s1",
        sessionId: "session-b",
        timestamp: "2026-03-02T00:00:04.000Z",
        type: "tool_result",
        payload: {
          command: "npm run lint --fix",
          output: "ok",
          isError: false,
        },
        metrics: {
          outcome: "success",
          latencyMs: 1_500,
          tokens: {
            inputUncached: 70,
            output: 12,
          },
        },
      }),
    ];

    const episodes = extractTrajectoryOutcomeEpisodes(events);
    const report = evaluateTrajectoryOutcomeGate(
      episodes,
      {
        minPairCount: 1,
        minRelativeHarmfulRetryReduction: 0.3,
        minRelativeWallTimeReduction: 0.1,
        minRelativeTokenCountReduction: 0.1,
        minJudgeableCoverage: 0.8,
      },
      {
        minOccurrencesPerFamily: 2,
        requireCrossSession: true,
      },
      {
        bootstrapSamples: 400,
        confidenceLevel: 0.9,
        seed: 17,
      },
    );

    expect(report.aggregate.totalPairs).toBe(1);
    expect(report.aggregate.totalHarmfulRetriesOff).toBe(2);
    expect(report.aggregate.totalHarmfulRetriesOn).toBe(1);
    expect(report.aggregate.relativeHarmfulRetryReduction).toBeGreaterThan(0.45);
    expect(report.aggregate.relativeWallTimeReduction).toBeGreaterThan(0.6);
    expect(report.aggregate.relativeTokenCountReduction).toBeGreaterThan(0.4);
    expect(report.aggregate.judgeableCoverageOff).toBe(1);
    expect(report.gateResult.pass).toBe(true);
  });

  it("fails when abstained failure coverage is too low", () => {
    const events: TraceEvent[] = [
      event({
        id: "x-f1",
        sessionId: "session-x",
        timestamp: "2026-03-01T00:00:01.000Z",
        type: "tool_result",
        payload: {
          command: "mytool apply",
          output: "boom",
          isError: true,
        },
        metrics: {
          outcome: "failure",
          latencyMs: 1_000,
        },
      }),
      event({
        id: "x-s1",
        sessionId: "session-x",
        timestamp: "2026-03-01T00:00:03.000Z",
        type: "tool_result",
        payload: {
          command: "mytool apply --retry",
          output: "ok",
          isError: false,
        },
        metrics: {
          outcome: "success",
          latencyMs: 1_000,
        },
      }),
      event({
        id: "y-f1",
        sessionId: "session-y",
        timestamp: "2026-03-02T00:00:01.000Z",
        type: "tool_result",
        payload: {
          command: "mytool apply",
          output: "boom",
          isError: true,
        },
        metrics: {
          outcome: "failure",
          latencyMs: 900,
        },
      }),
      event({
        id: "y-s1",
        sessionId: "session-y",
        timestamp: "2026-03-02T00:00:03.000Z",
        type: "tool_result",
        payload: {
          command: "mytool apply --retry",
          output: "ok",
          isError: false,
        },
        metrics: {
          outcome: "success",
          latencyMs: 900,
        },
      }),
    ];

    const episodes = extractTrajectoryOutcomeEpisodes(events);
    const report = evaluateTrajectoryOutcomeGate(
      episodes,
      {
        minPairCount: 1,
        minRelativeHarmfulRetryReduction: -1,
        minRelativeWallTimeReduction: -1,
        minRelativeTokenCountReduction: -1,
        minJudgeableCoverage: 0.8,
      },
      {
        minOccurrencesPerFamily: 2,
        requireCrossSession: true,
      },
      {
        bootstrapSamples: 300,
        confidenceLevel: 0.9,
        seed: 9,
      },
    );

    expect(report.aggregate.totalPairs).toBe(1);
    expect(report.aggregate.totalAbstainedRetriesOff).toBe(1);
    expect(report.aggregate.judgeableCoverageOff).toBe(0);
    expect(report.gateResult.pass).toBe(false);
    expect(
      report.gateResult.failures.some((failure) =>
        failure.startsWith("judgeable coverage off"),
      ),
    ).toBe(true);
  });
});
