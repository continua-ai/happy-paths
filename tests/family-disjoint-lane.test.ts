import { describe, expect, it } from "vitest";
import { buildFamilyDisjointEvalSlice } from "../src/core/familyDisjointLane.js";

type Episode = {
  id: string;
  familySignature: string;
};

describe("family disjoint eval slice", () => {
  it("removes eval episodes whose family appears in train", () => {
    const train: Episode[] = [
      {
        id: "train-1",
        familySignature: "family-a",
      },
      {
        id: "train-2",
        familySignature: "family-b",
      },
    ];

    const evalEpisodes: Episode[] = [
      {
        id: "eval-1",
        familySignature: "family-a",
      },
      {
        id: "eval-2",
        familySignature: "family-c",
      },
      {
        id: "eval-3",
        familySignature: "family-c",
      },
      {
        id: "eval-4",
        familySignature: "family-d",
      },
    ];

    const slice = buildFamilyDisjointEvalSlice(train, evalEpisodes);

    expect(slice.episodes.map((episode) => episode.id)).toEqual([
      "eval-2",
      "eval-3",
      "eval-4",
    ]);
    expect(slice.stats.trainFamilyCount).toBe(2);
    expect(slice.stats.evalFamilyCount).toBe(3);
    expect(slice.stats.disjointEvalFamilyCount).toBe(2);
    expect(slice.stats.removedEvalFamilyCount).toBe(1);
    expect(slice.stats.removedEpisodeCount).toBe(1);
    expect(slice.stats.keptEpisodeCount).toBe(3);
    expect(slice.stats.removedFamilies).toEqual(["family-a"]);
  });

  it("keeps all eval episodes when train has no overlap", () => {
    const train: Episode[] = [
      {
        id: "train-1",
        familySignature: "family-x",
      },
    ];

    const evalEpisodes: Episode[] = [
      {
        id: "eval-1",
        familySignature: "family-a",
      },
      {
        id: "eval-2",
        familySignature: "family-b",
      },
    ];

    const slice = buildFamilyDisjointEvalSlice(train, evalEpisodes);

    expect(slice.episodes).toEqual(evalEpisodes);
    expect(slice.stats.removedEvalFamilyCount).toBe(0);
    expect(slice.stats.removedEpisodeCount).toBe(0);
    expect(slice.stats.keptEpisodeCount).toBe(2);
    expect(slice.stats.removedFamilies).toEqual([]);
  });
});
