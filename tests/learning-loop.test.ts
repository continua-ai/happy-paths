import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileTraceStore } from "../src/backends/local/fileTraceStore.js";
import { InMemoryLexicalIndex } from "../src/backends/local/lexicalIndex.js";
import type { TraceIndex } from "../src/core/interfaces.js";
import { LearningLoop } from "../src/core/learningLoop.js";
import { SimpleWrongTurnMiner } from "../src/core/miner.js";
import type { IndexedDocument, SearchQuery, SearchResult } from "../src/core/types.js";

const tempDirs: string[] = [];

class StaticResultIndex implements TraceIndex {
  constructor(private readonly results: SearchResult[]) {}

  async upsert(_document: IndexedDocument): Promise<void> {
    return;
  }

  async upsertMany(_documents: IndexedDocument[]): Promise<void> {
    return;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    return this.results.slice(0, query.limit ?? this.results.length);
  }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const path = tempDirs.pop();
    if (!path) {
      continue;
    }
    await rm(path, { recursive: true, force: true });
  }
});

describe("LearningLoop", () => {
  it("ingests, retrieves, and suggests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new InMemoryLexicalIndex(),
      miner: new SimpleWrongTurnMiner(),
    });

    await loop.ingest({
      id: "evt-1",
      timestamp: new Date().toISOString(),
      sessionId: "session-a",
      harness: "pi",
      scope: "personal",
      type: "tool_result",
      payload: {
        command: "npm run lint",
        output: "Error: failed due to missing dependency",
        isError: true,
      },
      metrics: {
        outcome: "failure",
      },
    });

    const retrieval = await loop.retrieve({
      text: "missing dependency error",
    });

    expect(retrieval.length).toBeGreaterThan(0);

    const suggestions = await loop.suggest({ text: "lint failed missing dependency" });
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("applies result reranker while preserving original recall", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const baseResults: [SearchResult, SearchResult] = [
      {
        document: {
          id: "a",
          sourceEventId: "event-a",
          text: "first",
        },
        score: 0.2,
      },
      {
        document: {
          id: "b",
          sourceEventId: "event-b",
          text: "second",
        },
        score: 0.1,
      },
    ];

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex(baseResults),
      resultReranker: async () => {
        return [
          {
            ...baseResults[1],
            score: 10,
          },
          {
            ...baseResults[0],
            score: 9,
          },
          {
            document: {
              id: "unknown",
              sourceEventId: "event-unknown",
              text: "ignored",
            },
            score: 999,
          },
        ];
      },
    });

    const retrieval = await loop.retrieve({
      text: "anything",
      limit: 2,
    });

    expect(retrieval.map((hit) => hit.document.id)).toEqual(["b", "a"]);
    expect(retrieval[0]?.score).toBe(10);
    expect(retrieval).toHaveLength(2);
  });

  it("deduplicates retrieval hints and filters low-confidence suggestions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-a",
            sourceEventId: "event-a",
            text: 'tool_result pi {"command":"rg -n "needle" tests"}',
          },
          score: 10,
        },
        {
          document: {
            id: "doc-a-dup",
            sourceEventId: "event-a",
            text: 'tool_result pi {"command":"rg -n "needle" tests"}',
          },
          score: 9,
        },
        {
          document: {
            id: "doc-b-low",
            sourceEventId: "event-b",
            text: 'tool_result pi {"text":"low signal"}',
          },
          score: 0.5,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "find needle" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.evidenceEventIds).toEqual(["event-a"]);
    expect(suggestions[0]?.rationale).toContain("Prior run used");
    expect(suggestions[0]?.playbookMarkdown).toContain("Action:");
  });

  it("prefers non-error tool results over failure hits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-failure",
            sourceEventId: "event-failure",
            text: 'tool_result pi {"command":"pytest tests/failing_suite.py","isError":true}',
            metadata: {
              eventType: "tool_result",
              isError: true,
              outcome: "failure",
            },
          },
          score: 9,
        },
        {
          document: {
            id: "doc-success",
            sourceEventId: "event-success",
            text: 'tool_result pi {"command":"pytest tests/targeted_test.py","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 3,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "failing suite" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("Related prior tool result");
    expect(suggestions[0]?.evidenceEventIds).toEqual(["event-success"]);
    expect(suggestions[0]?.rationale).toContain("non-error tool result");
  });

  it("emits a cautionary warning when only failure evidence exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-failure-only",
            sourceEventId: "event-failure-only",
            text: 'tool_result pi {"command":"pytest tests/failing_suite.py","isError":true}',
            metadata: {
              eventType: "tool_result",
              isError: true,
              outcome: "failure",
            },
          },
          score: 4,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "failing suite" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("Prior failure warning");
    expect(suggestions[0]?.rationale).toContain("hit an error");
    expect(suggestions[0]?.playbookMarkdown).toContain("Confirm the root cause");
  });

  it("adds failure warnings when command/env mismatch signals are present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-success",
            sourceEventId: "event-success",
            text: 'tool_result pi {"command":"pytest tests/unit/test_models.py -k login","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 9,
        },
        {
          document: {
            id: "doc-mismatch-failure",
            sourceEventId: "event-mismatch-failure",
            text: 'tool_result pi {"command":"pytest tests/unit/test_models.py","text":"ModuleNotFoundError: No module named project.settings","isError":true}',
            metadata: {
              eventType: "tool_result",
              isError: true,
              outcome: "failure",
            },
          },
          score: 8,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "module not found" });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.title).toBe("Prior failure warning");
    expect(suggestions[0]?.rationale).toContain("mismatch patterns");
  });

  it("deprioritizes low-signal commands when better retrieval hints exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-low-signal",
            sourceEventId: "event-low-signal",
            text: 'tool_result pi {"command":"pytest","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 10,
        },
        {
          document: {
            id: "doc-targeted",
            sourceEventId: "event-targeted",
            text: 'tool_result pi {"command":"pytest tests/unit/test_models.py -k login --maxfail=1","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 4,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "test failure" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("Related prior tool result");
    expect(suggestions[0]?.evidenceEventIds).toEqual(["event-targeted"]);
  });

  it("falls back to a low-signal hint when no better retrieval exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-low-signal-only",
            sourceEventId: "event-low-signal-only",
            text: 'tool_result pi {"command":"pytest","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 7,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "test failure" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("Low-signal prior tool result");
    expect(suggestions[0]?.playbookMarkdown).toContain("low-signal");
  });

  it("prefers failure warnings over low-signal fallbacks when both exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-low-signal",
            sourceEventId: "event-low-signal",
            text: 'tool_result pi {"command":"pytest","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 8,
        },
        {
          document: {
            id: "doc-failure",
            sourceEventId: "event-failure",
            text: 'tool_result pi {"command":"pytest tests/full_suite.py","isError":true}',
            metadata: {
              eventType: "tool_result",
              isError: true,
              outcome: "failure",
            },
          },
          score: 7,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "test failure" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("Prior failure warning");
    expect(suggestions[0]?.title).not.toBe("Low-signal prior tool result");
  });

  it("treats forwarded test args as high-signal retrieval hints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-forwarded-args",
            sourceEventId: "event-forwarded-args",
            text: 'tool_result pi {"command":"npm run test -- --runInBand","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 8,
        },
        {
          document: {
            id: "doc-failure",
            sourceEventId: "event-failure",
            text: 'tool_result pi {"command":"npm run test","isError":true}',
            metadata: {
              eventType: "tool_result",
              isError: true,
              outcome: "failure",
            },
          },
          score: 7,
        },
      ]),
    });

    const suggestions = await loop.suggest({ text: "cannot find module" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("Related prior tool result");
    expect(suggestions[0]?.rationale).toContain("runInBand");
  });

  it("suppresses mined artifacts when retrieval hints already exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([
        {
          document: {
            id: "doc-success",
            sourceEventId: "event-success",
            text: 'tool_result pi {"command":"pytest tests/targeted_test.py","isError":false}',
            metadata: {
              eventType: "tool_result",
              isError: false,
              outcome: "success",
            },
          },
          score: 5,
        },
      ]),
      miner: new SimpleWrongTurnMiner(),
    });

    await loop.ingest({
      id: "evt-failure",
      timestamp: new Date().toISOString(),
      sessionId: "session-artifact",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py",
        isError: true,
        text: "failed",
      },
      metrics: {
        outcome: "failure",
      },
    });

    await loop.ingest({
      id: "evt-success",
      timestamp: new Date().toISOString(),
      sessionId: "session-artifact",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py -k failing_case --maxfail=1",
        isError: false,
        text: "passed",
      },
      metrics: {
        outcome: "success",
      },
    });

    const suggestions = await loop.suggest({ text: "targeted run" });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(
      suggestions.some(
        (suggestion) => suggestion.title === "Learned wrong-turn correction",
      ),
    ).toBe(false);
  });

  it("uses mined artifacts when retrieval yields no suggestions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([]),
      miner: new SimpleWrongTurnMiner(),
    });

    await loop.ingest({
      id: "evt-failure-no-retrieval-a",
      timestamp: new Date().toISOString(),
      sessionId: "session-artifact-only-a",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py",
        isError: true,
        text: "failed",
      },
      metrics: {
        outcome: "failure",
      },
    });

    await loop.ingest({
      id: "evt-success-no-retrieval-a",
      timestamp: new Date().toISOString(),
      sessionId: "session-artifact-only-a",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py -k failing_case --maxfail=1",
        isError: false,
        text: "passed",
      },
      metrics: {
        outcome: "success",
      },
    });

    await loop.ingest({
      id: "evt-failure-no-retrieval-b",
      timestamp: new Date().toISOString(),
      sessionId: "session-artifact-only-b",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py",
        isError: true,
        text: "failed again",
      },
      metrics: {
        outcome: "failure",
      },
    });

    await loop.ingest({
      id: "evt-success-no-retrieval-b",
      timestamp: new Date().toISOString(),
      sessionId: "session-artifact-only-b",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py -k failing_case --maxfail=1",
        isError: false,
        text: "passed again",
      },
      metrics: {
        outcome: "success",
      },
    });

    const suggestions = await loop.suggest({ text: "targeted run" });

    expect(
      suggestions.some(
        (suggestion) => suggestion.title === "Learned wrong-turn correction",
      ),
    ).toBe(true);
  });

  it("falls back to verify-first guidance when artifact support is weak", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-"));
    tempDirs.push(dir);

    const loop = new LearningLoop({
      store: new FileTraceStore(dir),
      index: new StaticResultIndex([]),
      miner: new SimpleWrongTurnMiner(),
    });

    await loop.ingest({
      id: "evt-failure-weak-artifact",
      timestamp: new Date().toISOString(),
      sessionId: "session-weak-artifact",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py",
        isError: true,
        text: "failed",
      },
      metrics: {
        outcome: "failure",
      },
    });

    await loop.ingest({
      id: "evt-success-weak-artifact",
      timestamp: new Date().toISOString(),
      sessionId: "session-weak-artifact",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        command: "pytest tests/full_suite.py -k failing_case --maxfail=1",
        isError: false,
        text: "passed",
      },
      metrics: {
        outcome: "success",
      },
    });

    const suggestions = await loop.suggest({ text: "targeted run" });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("Verify-first fallback");
    expect(suggestions[0]?.playbookMarkdown).toContain("focused verification");
  });
});
