import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiTraceExtension } from "../src/adapters/pi/extension.js";
import type { PiLikeApi } from "../src/adapters/pi/types.js";
import { createLocalLearningLoop } from "../src/backends/local/index.js";
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
});
