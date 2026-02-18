import { describe, expect, it } from "vitest";
import { InMemoryLexicalIndex } from "../src/backends/local/lexicalIndex.js";

describe("InMemoryLexicalIndex", () => {
  it("ranks exact-ish lexical hits first", async () => {
    const index = new InMemoryLexicalIndex();

    await index.upsertMany([
      {
        id: "1",
        sourceEventId: "evt-1",
        text: "python traceback file not found src/foo.py",
        metadata: { eventType: "tool_result" },
      },
      {
        id: "2",
        sourceEventId: "evt-2",
        text: "lint warning in src/bar.ts",
        metadata: { eventType: "tool_result" },
      },
    ]);

    const hits = await index.search({ text: "traceback file not found", limit: 5 });

    expect(hits).toHaveLength(1);
    const first = hits.at(0);
    expect(first?.document.id).toBe("1");
  });

  it("prefers fuller lexical matches over single-term repetition", async () => {
    const index = new InMemoryLexicalIndex();

    await index.upsertMany([
      {
        id: "full-match",
        sourceEventId: "evt-full",
        text: "traceback fix applied",
        metadata: { scope: "team" },
      },
      {
        id: "repeated",
        sourceEventId: "evt-repeated",
        text: new Array(80).fill("traceback").join(" "),
        metadata: { scope: "team" },
      },
    ]);

    const hits = await index.search({ text: "traceback fix", limit: 2 });

    expect(hits).toHaveLength(2);
    const first = hits.at(0);
    expect(first?.document.id).toBe("full-match");
  });

  it("applies metadata filters", async () => {
    const index = new InMemoryLexicalIndex();

    await index.upsertMany([
      {
        id: "a",
        sourceEventId: "evt-a",
        text: "npm test failed",
        metadata: { scope: "team" },
      },
      {
        id: "b",
        sourceEventId: "evt-b",
        text: "npm test failed",
        metadata: { scope: "personal" },
      },
    ]);

    const hits = await index.search({
      text: "npm test failed",
      filters: { scope: "personal" },
    });

    expect(hits).toHaveLength(1);
    const first = hits.at(0);
    expect(first?.document.id).toBe("b");
  });

  it("preserves tail tokens when query term count is capped", async () => {
    const index = new InMemoryLexicalIndex({ maxQueryTerms: 4 });

    await index.upsertMany([
      {
        id: "head-noise",
        sourceEventId: "evt-head",
        text: "alpha beta gamma",
      },
      {
        id: "tail-target",
        sourceEventId: "evt-tail",
        text: "tailneedle uniquefix",
      },
    ]);

    const hits = await index.search({
      text: "alpha beta gamma delta epsilon zeta tailneedle",
      limit: 5,
    });

    expect(hits.map((hit) => hit.document.id)).toContain("tail-target");
  });
});
