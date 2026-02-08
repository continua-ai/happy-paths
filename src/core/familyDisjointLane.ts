export interface FamilySignatureEpisode {
  familySignature: string;
}

export interface FamilyDisjointEvalSliceStats {
  trainFamilyCount: number;
  evalFamilyCount: number;
  disjointEvalFamilyCount: number;
  removedEvalFamilyCount: number;
  removedEpisodeCount: number;
  keptEpisodeCount: number;
  removedFamilies: string[];
}

export interface FamilyDisjointEvalSlice<T extends FamilySignatureEpisode> {
  episodes: T[];
  stats: FamilyDisjointEvalSliceStats;
}

export function buildFamilyDisjointEvalSlice<T extends FamilySignatureEpisode>(
  trainEpisodes: T[],
  evalEpisodes: T[],
): FamilyDisjointEvalSlice<T> {
  const trainFamilies = new Set(
    trainEpisodes.map((episode) => episode.familySignature),
  );
  const evalFamilies = new Set(evalEpisodes.map((episode) => episode.familySignature));

  const removedFamilies = [...evalFamilies]
    .filter((family) => trainFamilies.has(family))
    .sort();

  const removedFamilySet = new Set(removedFamilies);

  const keptEpisodes = evalEpisodes.filter((episode) => {
    return !removedFamilySet.has(episode.familySignature);
  });

  const keptFamilies = new Set(keptEpisodes.map((episode) => episode.familySignature));

  return {
    episodes: keptEpisodes,
    stats: {
      trainFamilyCount: trainFamilies.size,
      evalFamilyCount: evalFamilies.size,
      disjointEvalFamilyCount: keptFamilies.size,
      removedEvalFamilyCount: removedFamilySet.size,
      removedEpisodeCount: Math.max(0, evalEpisodes.length - keptEpisodes.length),
      keptEpisodeCount: keptEpisodes.length,
      removedFamilies,
    },
  };
}
