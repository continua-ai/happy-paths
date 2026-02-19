import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiTraceExtension } from "../src/adapters/pi/extension.js";
import type { PiLikeApi } from "../src/adapters/pi/types.js";
import { createLocalLearningLoop } from "../src/backends/local/index.js";
import type { LearningLoop } from "../src/core/learningLoop.js";
import {
  DEFAULT_PROJECT_IDENTITY,
  resolveProjectIdentity,
} from "../src/core/projectIdentity.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const path = tempDirs.pop();
    if (!path) {
      continue;
    }
    await rm(path, { recursive: true, force: true });
  }
});

type PiHandler = (event: unknown, context: unknown) => Promise<unknown> | unknown;

class FakePiApi implements PiLikeApi {
  private readonly handlers = new Map<string, PiHandler>();

  on(eventName: string, handler: PiHandler): void {
    this.handlers.set(eventName, handler);
  }

  async emit(eventName: string, event: unknown): Promise<unknown> {
    const handler = this.handlers.get(eventName);
    if (!handler) {
      throw new Error(`Missing handler for ${eventName}`);
    }
    return handler(event, {});
  }
}

describe("project identity", () => {
  it("resolves defaults and overrides", () => {
    const identity = resolveProjectIdentity({
      displayName: "FutureName",
      extensionCustomType: "future-name",
    });

    expect(identity.displayName).toBe("FutureName");
    expect(identity.extensionCustomType).toBe("future-name");
    expect(identity.slug).toBe(DEFAULT_PROJECT_IDENTITY.slug);
    expect(identity.npmPackageName).toBe(DEFAULT_PROJECT_IDENTITY.npmPackageName);
  });

  it("uses identity default data directory for local loop", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "happy-paths-identity-"));
    tempDirs.push(rootDir);

    const previousCwd = process.cwd();
    process.chdir(rootDir);
    try {
      const loop = createLocalLearningLoop({
        projectIdentity: {
          defaultDataDirName: ".renamable-project",
        },
      });

      await loop.ingest({
        id: "evt-identity",
        timestamp: new Date().toISOString(),
        sessionId: "session-identity",
        harness: "pi",
        scope: "personal",
        type: "tool_result",
        payload: {
          text: "Error: cannot find module",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      });

      const stored = await readFile(
        join(rootDir, ".renamable-project", "sessions", "session-identity.jsonl"),
        "utf-8",
      );

      expect(stored).toContain("evt-identity");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("uses identity custom message type in pi extension", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "happy-paths-extension-"));
    tempDirs.push(dataDir);

    const loop = createLocalLearningLoop({ dataDir });
    await loop.ingest({
      id: "evt-extension",
      timestamp: new Date().toISOString(),
      sessionId: "session-extension",
      harness: "pi",
      scope: "personal",
      type: "tool_result",
      payload: {
        text: "Error: missing dependency",
        isError: true,
      },
      metrics: {
        outcome: "failure",
      },
    });

    const fakePi = new FakePiApi();
    createPiTraceExtension({
      loop,
      projectIdentity: {
        extensionCustomType: "future-project-name",
      },
    })(fakePi);

    const response = (await fakePi.emit("before_agent_start", {
      prompt: "missing dependency",
      systemPrompt: "",
    })) as
      | {
          message?: {
            customType?: string;
          };
        }
      | undefined;

    expect(response?.message?.customType).toBe("future-project-name");
  });

  it("prefers non-error hint retrieval mode before broad fallback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "happy-paths-extension-hint-mode-"));
    tempDirs.push(dataDir);

    const loop = createLocalLearningLoop({ dataDir });
    await loop.ingest({
      id: "evt-failure",
      timestamp: new Date().toISOString(),
      sessionId: "seed-history",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        toolName: "bash",
        command: "pytest tests/full_suite.py",
        text: "Command failed",
        isError: true,
      },
      metrics: {
        outcome: "failure",
      },
    });
    await loop.ingest({
      id: "evt-success",
      timestamp: new Date().toISOString(),
      sessionId: "seed-history",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        toolName: "bash",
        command: "pytest tests/full_suite.py -k failing_case --maxfail=1",
        text: "Targeted run passed",
        isError: false,
      },
      metrics: {
        outcome: "success",
      },
    });

    const fakePi = new FakePiApi();
    const sessionId = "session-hint-mode";
    createPiTraceExtension({
      loop,
      sessionId,
      maxSuggestions: 3,
    })(fakePi);

    const response = (await fakePi.emit("before_agent_start", {
      prompt: "pytest full_suite failing_case",
      systemPrompt: "",
    })) as
      | {
          message?: {
            content?: string;
          };
        }
      | undefined;

    expect(response?.message?.content).toMatch(/--maxfail=(1|<num>)/);

    const stored = await readFile(
      join(dataDir, "sessions", `${sessionId}.jsonl`),
      "utf-8",
    );
    const checkpoint = stored
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { type?: string; payload?: Record<string, unknown> },
      )
      .find((event) => event.type === "checkpoint");

    expect(checkpoint?.payload?.retrievalOutcomeFilter).toBe("non_error");
    expect(checkpoint?.payload?.retrievalHintCount).toBeGreaterThan(0);
    expect(checkpoint?.payload?.artifactHintCount).toBe(0);
    expect(checkpoint?.payload?.fallbackToGlobalToolResults).toBe(false);
  });

  it("does not inject hints when only the current prompt has been ingested", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "happy-paths-extension-self-filter-"));
    tempDirs.push(dataDir);

    const loop = createLocalLearningLoop({ dataDir });
    const fakePi = new FakePiApi();
    const sessionId = "session-self-filter";

    createPiTraceExtension({
      loop,
      sessionId,
      maxSuggestions: 3,
    })(fakePi);

    await fakePi.emit("input", {
      text: "Investigate callable filepath behavior",
      source: "interactive",
    });

    const response = await fakePi.emit("before_agent_start", {
      prompt: "Investigate callable filepath behavior",
      systemPrompt: "",
    });

    expect(response).toBeUndefined();

    const stored = await readFile(
      join(dataDir, "sessions", `${sessionId}.jsonl`),
      "utf-8",
    );
    const checkpoint = stored
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { type?: string; payload?: Record<string, unknown> },
      )
      .find((event) => event.type === "checkpoint");

    expect(checkpoint?.payload?.hintCount).toBe(0);
    expect(checkpoint?.payload?.retrievalHintCount).toBe(0);
    expect(checkpoint?.payload?.artifactHintCount).toBe(0);
    expect(checkpoint?.payload?.retrievalOutcomeFilter).toBe("any");
    expect(Number(checkpoint?.payload?.selfFilteredHintCount ?? 0)).toBe(0);
  });

  it("keeps one failure warning in top suggestions when available", async () => {
    const ingestedEvents: Array<{
      type: string;
      payload: Record<string, unknown>;
    }> = [];

    const fakeLoop = {
      async ingest(event: {
        type: string;
        payload: Record<string, unknown>;
      }): Promise<void> {
        ingestedEvents.push(event);
      },
      async suggest(): Promise<
        Array<{
          id: string;
          title: string;
          rationale: string;
          confidence: number;
          evidenceEventIds: string[];
          playbookMarkdown: string;
        }>
      > {
        return [
          {
            id: "retrieval-high",
            title: "Related prior tool result",
            rationale: "high confidence retrieval",
            confidence: 0.95,
            evidenceEventIds: ["evt-high"],
            playbookMarkdown: "- Action: high",
          },
          {
            id: "retrieval-mid",
            title: "Related prior tool result",
            rationale: "mid confidence retrieval",
            confidence: 0.8,
            evidenceEventIds: ["evt-mid"],
            playbookMarkdown: "- Action: mid",
          },
          {
            id: "retrieval-low",
            title: "Related prior tool result",
            rationale: "low confidence retrieval",
            confidence: 0.7,
            evidenceEventIds: ["evt-low"],
            playbookMarkdown: "- Action: low",
          },
          {
            id: "failure-warning",
            title: "Prior failure warning",
            rationale: "prior failure",
            confidence: 0.2,
            evidenceEventIds: ["evt-failure"],
            playbookMarkdown: "- Action: verify first",
          },
        ];
      },
    } as unknown as LearningLoop;

    const fakePi = new FakePiApi();
    createPiTraceExtension({
      loop: fakeLoop,
      sessionId: "session-failure-warning-selection",
      maxSuggestions: 3,
    })(fakePi);

    await fakePi.emit("input", {
      text: "Investigate failure warning selection",
      source: "interactive",
    });

    const response = (await fakePi.emit("before_agent_start", {
      prompt: "Investigate failure warning selection",
      systemPrompt: "",
    })) as
      | {
          message?: {
            content?: string;
          };
        }
      | undefined;

    expect(response?.message?.content).toContain("Prior trace hints:");

    const checkpoint = ingestedEvents.find((event) => event.type === "checkpoint");
    expect(checkpoint?.payload?.failureWarningHintCount).toBe(1);
    expect(checkpoint?.payload?.availableFailureWarningHintCount).toBe(1);
  });

  it("supports artifact-only hint mode", async () => {
    const ingestedEvents: Array<{
      type: string;
      payload: Record<string, unknown>;
    }> = [];

    const fakeLoop = {
      async ingest(event: {
        type: string;
        payload: Record<string, unknown>;
      }): Promise<void> {
        ingestedEvents.push(event);
      },
      async suggest(): Promise<
        Array<{
          id: string;
          title: string;
          rationale: string;
          confidence: number;
          evidenceEventIds: string[];
          playbookMarkdown: string;
        }>
      > {
        return [
          {
            id: "retrieval-1",
            title: "Related prior tool result",
            rationale: "retrieval hint",
            confidence: 0.95,
            evidenceEventIds: ["evt-retrieval"],
            playbookMarkdown: "- Action: retrieval",
          },
          {
            id: "artifact-1",
            title: "Learned wrong-turn correction",
            rationale: "artifact hint",
            confidence: 0.7,
            evidenceEventIds: ["evt-artifact"],
            playbookMarkdown: "- Action: artifact",
          },
        ];
      },
    } as unknown as LearningLoop;

    const fakePi = new FakePiApi();
    createPiTraceExtension({
      loop: fakeLoop,
      sessionId: "session-artifact-only",
      maxSuggestions: 1,
      hintMode: "artifact_only",
    })(fakePi);

    const response = (await fakePi.emit("before_agent_start", {
      prompt: "investigate artifact-only mode",
      systemPrompt: "",
    })) as
      | {
          message?: {
            content?: string;
          };
        }
      | undefined;

    expect(response?.message?.content).toContain("artifact hint");
    expect(response?.message?.content).not.toContain("retrieval hint");

    const checkpoint = ingestedEvents.find((event) => event.type === "checkpoint");
    expect(checkpoint?.payload?.hintMode).toBe("artifact_only");
    expect(checkpoint?.payload?.hintCount).toBe(1);
    expect(checkpoint?.payload?.retrievalHintCount).toBe(0);
    expect(checkpoint?.payload?.artifactHintCount).toBe(1);
  });

  it("abstains when only weak retrieval hints are available", async () => {
    const ingestedEvents: Array<{
      type: string;
      payload: Record<string, unknown>;
    }> = [];

    const fakeLoop = {
      async ingest(event: {
        type: string;
        payload: Record<string, unknown>;
      }): Promise<void> {
        ingestedEvents.push(event);
      },
      async suggest(): Promise<
        Array<{
          id: string;
          title: string;
          rationale: string;
          confidence: number;
          evidenceEventIds: string[];
          playbookMarkdown: string;
        }>
      > {
        return [
          {
            id: "retrieval-weak",
            title: "Related prior tool result",
            rationale: "weak retrieval hint",
            confidence: 0.45,
            evidenceEventIds: ["evt-weak"],
            playbookMarkdown: "- Action: weak",
          },
        ];
      },
    } as unknown as LearningLoop;

    const fakePi = new FakePiApi();
    createPiTraceExtension({
      loop: fakeLoop,
      sessionId: "session-abstain-weak-retrieval",
      maxSuggestions: 3,
    })(fakePi);

    const response = await fakePi.emit("before_agent_start", {
      prompt: "investigate weak retrieval confidence",
      systemPrompt: "",
    });

    expect(response).toBeUndefined();

    const checkpoint = ingestedEvents.find((event) => event.type === "checkpoint");
    expect(checkpoint?.payload?.hintPolicyVersion).toBe(
      "v2_artifact_first_confidence_gate",
    );
    expect(checkpoint?.payload?.hintCount).toBe(0);
    expect(checkpoint?.payload?.availableRetrievalHintCount).toBe(1);
    expect(checkpoint?.payload?.filteredLowConfidenceRetrievalHintCount).toBe(1);
  });

  it("prioritizes artifact hints and caps retrieval hints", async () => {
    const ingestedEvents: Array<{
      type: string;
      payload: Record<string, unknown>;
    }> = [];

    const fakeLoop = {
      async ingest(event: {
        type: string;
        payload: Record<string, unknown>;
      }): Promise<void> {
        ingestedEvents.push(event);
      },
      async suggest(): Promise<
        Array<{
          id: string;
          title: string;
          rationale: string;
          confidence: number;
          evidenceEventIds: string[];
          playbookMarkdown: string;
        }>
      > {
        return [
          {
            id: "retrieval-high-1",
            title: "Related prior tool result",
            rationale: "retrieval one",
            confidence: 0.95,
            evidenceEventIds: ["evt-r1"],
            playbookMarkdown: "- Action: retrieval one",
          },
          {
            id: "retrieval-high-2",
            title: "Related prior tool result",
            rationale: "retrieval two",
            confidence: 0.9,
            evidenceEventIds: ["evt-r2"],
            playbookMarkdown: "- Action: retrieval two",
          },
          {
            id: "retrieval-high-3",
            title: "Related prior tool result",
            rationale: "retrieval three",
            confidence: 0.88,
            evidenceEventIds: ["evt-r3"],
            playbookMarkdown: "- Action: retrieval three",
          },
          {
            id: "artifact-strong",
            title: "Learned wrong-turn correction",
            rationale: "artifact correction",
            confidence: 0.8,
            evidenceEventIds: ["evt-artifact"],
            playbookMarkdown: "- Action: artifact correction",
          },
        ];
      },
    } as unknown as LearningLoop;

    const fakePi = new FakePiApi();
    createPiTraceExtension({
      loop: fakeLoop,
      sessionId: "session-artifact-priority",
      maxSuggestions: 3,
    })(fakePi);

    const response = (await fakePi.emit("before_agent_start", {
      prompt: "investigate artifact priority",
      systemPrompt: "",
    })) as
      | {
          message?: {
            content?: string;
          };
        }
      | undefined;

    expect(response?.message?.content).toContain("artifact correction");

    const checkpoint = ingestedEvents.find((event) => event.type === "checkpoint");
    expect(checkpoint?.payload?.artifactHintCount).toBe(1);
    expect(checkpoint?.payload?.retrievalHintCount).toBe(1);
    expect(checkpoint?.payload?.hintCount).toBe(2);
    expect(checkpoint?.payload?.availableRetrievalHintCount).toBe(3);
    expect(checkpoint?.payload?.policySuppressedByBudgetCount).toBeGreaterThan(0);
  });

  it("bounds retrieval query text for long prompts", async () => {
    const ingestedEvents: Array<{
      type: string;
      payload: Record<string, unknown>;
    }> = [];
    const seenQueries: string[] = [];

    const fakeLoop = {
      async ingest(event: {
        type: string;
        payload: Record<string, unknown>;
      }): Promise<void> {
        ingestedEvents.push(event);
      },
      async suggest(query: { text: string }): Promise<
        Array<{
          id: string;
          title: string;
          rationale: string;
          confidence: number;
          evidenceEventIds: string[];
          playbookMarkdown: string;
        }>
      > {
        seenQueries.push(query.text);
        return [];
      },
    } as unknown as LearningLoop;

    const fakePi = new FakePiApi();
    createPiTraceExtension({
      loop: fakeLoop,
      sessionId: "session-bounded-query",
      maxSuggestions: 3,
      suggestionQueryMaxChars: 600,
    })(fakePi);

    const longPrompt = `${"prefix-token ".repeat(800)}TAIL_CONTEXT_SENTINEL`;
    await fakePi.emit("before_agent_start", {
      prompt: longPrompt,
      systemPrompt: "",
    });

    expect(seenQueries.length).toBeGreaterThan(0);
    expect(seenQueries[0]?.length ?? 0).toBeLessThanOrEqual(620);
    expect(seenQueries[0]).toContain("TAIL_CONTEXT_SENTINEL");

    const checkpoint = ingestedEvents.find((event) => event.type === "checkpoint");
    expect(checkpoint?.payload?.retrievalPromptTruncated).toBe(true);
    expect(
      Number(checkpoint?.payload?.retrievalQueryTextLength ?? 0),
    ).toBeLessThanOrEqual(620);
  });

  it("fails open when retrieval planning exceeds the configured timeout", async () => {
    const ingestedEvents: Array<{
      type: string;
      payload: Record<string, unknown>;
    }> = [];

    const fakeLoop = {
      async ingest(event: {
        type: string;
        payload: Record<string, unknown>;
      }): Promise<void> {
        ingestedEvents.push(event);
      },
      async suggest(): Promise<
        Array<{
          id: string;
          title: string;
          rationale: string;
          confidence: number;
          evidenceEventIds: string[];
          playbookMarkdown: string;
        }>
      > {
        return await new Promise(() => {
          // Intentionally unresolved to force retrieval timeout handling.
        });
      },
    } as unknown as LearningLoop;

    const fakePi = new FakePiApi();
    createPiTraceExtension({
      loop: fakeLoop,
      sessionId: "session-retrieval-timeout",
      maxSuggestions: 3,
      suggestionPlanTimeoutMs: 10,
      suggestionTotalTimeoutMs: 20,
    })(fakePi);

    const startedAtMs = Date.now();
    const response = await fakePi.emit("before_agent_start", {
      prompt: "trigger timeout",
      systemPrompt: "",
    });
    const elapsedMs = Date.now() - startedAtMs;

    expect(response).toBeUndefined();
    expect(elapsedMs).toBeLessThan(500);

    const checkpoint = ingestedEvents.find((event) => event.type === "checkpoint");
    expect(checkpoint?.payload?.retrievalTimedOut).toBe(true);
    expect(checkpoint?.payload?.hintCount).toBe(0);
  });
});
