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
});
