import { describe, expect, it } from "vitest";
import { CompositeTraceIndex } from "../src/core/compositeIndex.js";
import type { TraceIndex } from "../src/core/interfaces.js";
import type { IndexedDocument, SearchQuery, SearchResult } from "../src/core/types.js";

class FakeIndex implements TraceIndex {
  public readonly upsertedIds: string[] = [];
  public readonly upsertManyCalls: number[] = [];

  constructor(private readonly results: SearchResult[]) {}

  async upsert(document: IndexedDocument): Promise<void> {
    this.upsertedIds.push(document.id);
  }

  async upsertMany(documents: IndexedDocument[]): Promise<void> {
    this.upsertManyCalls.push(documents.length);
    for (const document of documents) {
      this.upsertedIds.push(document.id);
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    return this.results.slice(0, query.limit ?? this.results.length);
  }
}

function result(id: string): SearchResult {
  return {
    document: {
      id,
      sourceEventId: `event-${id}`,
      text: `document-${id}`,
    },
    score: 1,
  };
}

describe("CompositeTraceIndex", () => {
  it("delegates to primary index when no secondary is configured", async () => {
    const primary = new FakeIndex([result("a"), result("b")]);
    const index = new CompositeTraceIndex({
      primary,
    });

    const hits = await index.search({ text: "anything", limit: 2 });
    expect(hits.map((hit) => hit.document.id)).toEqual(["a", "b"]);
  });

  it("fuses ranking with reciprocal rank fusion", async () => {
    const primary = new FakeIndex([result("a"), result("b")]);
    const secondary = new FakeIndex([result("b"), result("c")]);

    const index = new CompositeTraceIndex({
      primary,
      secondary,
      reciprocalRankFusionK: 0,
      primaryWeight: 1,
      secondaryWeight: 1,
    });

    const hits = await index.search({ text: "anything", limit: 3 });

    expect(hits.map((hit) => hit.document.id)).toEqual(["b", "a", "c"]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it("supports source weighting that favors primary results", async () => {
    const primary = new FakeIndex([result("a"), result("b")]);
    const secondary = new FakeIndex([result("b"), result("c")]);

    const index = new CompositeTraceIndex({
      primary,
      secondary,
      reciprocalRankFusionK: 0,
      primaryWeight: 3,
      secondaryWeight: 1,
    });

    const hits = await index.search({ text: "anything", limit: 3 });

    expect(hits.map((hit) => hit.document.id)).toEqual(["a", "b", "c"]);
    expect((hits[0]?.score ?? 0) - (hits[1]?.score ?? 0)).toBeGreaterThan(0);
  });

  it("throws on non-positive source weights", () => {
    const primary = new FakeIndex([]);

    expect(() => {
      new CompositeTraceIndex({
        primary,
        primaryWeight: 0,
      });
    }).toThrow("Source weight must be a finite positive number");
  });

  it("writes to both indexes on upsert and upsertMany", async () => {
    const primary = new FakeIndex([]);
    const secondary = new FakeIndex([]);

    const index = new CompositeTraceIndex({
      primary,
      secondary,
    });

    await index.upsert({
      id: "x",
      sourceEventId: "event-x",
      text: "x",
    });

    await index.upsertMany([
      {
        id: "y",
        sourceEventId: "event-y",
        text: "y",
      },
      {
        id: "z",
        sourceEventId: "event-z",
        text: "z",
      },
    ]);

    expect(primary.upsertedIds).toEqual(["x", "y", "z"]);
    expect(secondary.upsertedIds).toEqual(["x", "y", "z"]);
    expect(primary.upsertManyCalls).toEqual([2]);
    expect(secondary.upsertManyCalls).toEqual([2]);
  });
});
