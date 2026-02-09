import { createHash } from "node:crypto";

type PrimaryLane = "full_eval" | "family_disjoint_eval";

type TrajectoryIssueKind =
  | "benign_probe"
  | "transient_external"
  | "command_mismatch"
  | "environment_mismatch"
  | "missing_context"
  | "unknown_failure";

type TrajectoryIssueKindCounts = Record<TrajectoryIssueKind, number>;

type TrajectoryPairLike = {
  id?: string;
  offEpisodeId?: string;
  onEpisodeId?: string;
  offStartedAt?: string;
  onStartedAt?: string;
  qualityScore?: number;
  familySignature: string;
  offSessionId: string;
  onSessionId: string;
  totalRetriesOff: number;
  totalRetriesOn: number;
  harmfulRetriesOff: number;
  harmfulRetriesOn: number;
  benignRetriesOff: number;
  benignRetriesOn: number;
  abstainedRetriesOff: number;
  abstainedRetriesOn: number;
  wallTimeOffMs: number;
  wallTimeOnMs: number;
  tokenCountOff: number;
  tokenCountOn: number;
  tokenProxyOff: number;
  tokenProxyOn: number;
  costOffUsd: number;
  costOnUsd: number;
  successOff: boolean;
  successOn: boolean;
};

type TrajectoryDebugPair = {
  pairId: string;
  familyId: string;
  familySignature: string;
  toolSurface: string;
  offSessionId: string;
  onSessionId: string;
  offStartedAt: string | null;
  onStartedAt: string | null;
  totalRetriesOff: number;
  totalRetriesOn: number;
  harmfulRetriesOff: number;
  harmfulRetriesOn: number;
  benignRetriesOff: number;
  benignRetriesOn: number;
  abstainedRetriesOff: number;
  abstainedRetriesOn: number;
  wallTimeOffMs: number;
  wallTimeOnMs: number;
  tokenCountOff: number;
  tokenCountOn: number;
  tokenProxyOff: number;
  tokenProxyOn: number;
  costOffUsd: number;
  costOnUsd: number;
  successOff: boolean;
  successOn: boolean;
  qualityScore: number | null;
  issueKindsOff: TrajectoryIssueKindCounts;
  issueKindsOn: TrajectoryIssueKindCounts;
  deltas: {
    harmfulRetriesDelta: number;
    wallTimeDeltaMs: number;
    tokenCountDelta: number;
  };
};

type TrajectoryDebugFamily = {
  familyId: string;
  familySignature: string;
  toolSurface: string;
  pairCount: number;
  totals: {
    totalRetriesOff: number;
    totalRetriesOn: number;
    harmfulRetriesOff: number;
    harmfulRetriesOn: number;
    benignRetriesOff: number;
    benignRetriesOn: number;
    abstainedRetriesOff: number;
    abstainedRetriesOn: number;
    wallTimeOffMs: number;
    wallTimeOnMs: number;
    tokenCountOff: number;
    tokenCountOn: number;
    tokenProxyOff: number;
    tokenProxyOn: number;
    costOffUsd: number;
    costOnUsd: number;
  };
  judgeableCoverage: {
    off: number;
    on: number;
  };
  deltas: {
    relativeHarmfulRetryReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
  };
  issueKindsOff: TrajectoryIssueKindCounts;
  issueKindsOn: TrajectoryIssueKindCounts;
};

type TrajectoryLaneDebug = {
  lane: PrimaryLane;
  pairCount: number;
  familyCount: number;
  families: TrajectoryDebugFamily[];
  topFamiliesByPairCount: TrajectoryDebugFamily[];
  worstFamiliesByHarmfulRetryReduction: TrajectoryDebugFamily[];
  worstFamiliesByWallTimeReduction: TrajectoryDebugFamily[];
  worstFamiliesByTokenCountReduction: TrajectoryDebugFamily[];
  worstPairsByHarmfulRetriesDelta: TrajectoryDebugPair[];
  worstPairsByWallTimeDelta: TrajectoryDebugPair[];
  worstPairsByTokenCountDelta: TrajectoryDebugPair[];
};

type TrajectoryOutcomeDebugReport = {
  schemaVersion: 1;
  generatedAtUtc: string;
  traceRoot: string;
  format: string;
  toolName: string;
  primaryLane: PrimaryLane;
  lanes: {
    full_eval: TrajectoryLaneDebug;
    family_disjoint_eval: TrajectoryLaneDebug;
  };
};

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sanitizeDebugText(text: string): string {
  return text
    .replace(/authorization:\s*bearer\s+[^\s"']+/gi, "authorization: bearer <redacted>")
    .replace(/\b(api[_-]?key|token|secret|password)=\S+/gi, "$1=<redacted>")
    .replace(/\/Users\/[^/\s]+/g, "/Users/<user>")
    .replace(/\/home\/[^/\s]+/g, "/home/<user>");
}

function debugFamilyId(familySignature: string): string {
  return sha256Hex(familySignature).slice(0, 16);
}

function safeRelativeReduction(off: number, on: number): number {
  if (off <= 0) {
    return on <= 0 ? 0 : -1;
  }
  return (off - on) / off;
}

function takeLimited<T>(items: T[], limit: number): T[] {
  if (limit <= 0 || items.length <= limit) {
    return items;
  }
  return items.slice(0, limit);
}

function emptyIssueKindCounts(): TrajectoryIssueKindCounts {
  return {
    benign_probe: 0,
    transient_external: 0,
    command_mismatch: 0,
    environment_mismatch: 0,
    missing_context: 0,
    unknown_failure: 0,
  };
}

function addIssueKindCounts(
  target: TrajectoryIssueKindCounts,
  source: TrajectoryIssueKindCounts,
): void {
  for (const key of Object.keys(target) as TrajectoryIssueKind[]) {
    target[key] = (target[key] ?? 0) + (source[key] ?? 0);
  }
}

function issueKindCountsFromEpisode(episode: unknown): TrajectoryIssueKindCounts {
  const counts = emptyIssueKindCounts();

  if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
    return counts;
  }

  const issuesValue = (episode as Record<string, unknown>).issues;
  if (!Array.isArray(issuesValue)) {
    return counts;
  }

  for (const rawIssue of issuesValue) {
    if (!rawIssue || typeof rawIssue !== "object" || Array.isArray(rawIssue)) {
      continue;
    }

    const kindValue = String((rawIssue as Record<string, unknown>).kind ?? "");
    const kind = (
      kindValue === "benign_probe" ||
      kindValue === "transient_external" ||
      kindValue === "command_mismatch" ||
      kindValue === "environment_mismatch" ||
      kindValue === "missing_context" ||
      kindValue === "unknown_failure"
        ? kindValue
        : null
    ) as TrajectoryIssueKind | null;

    if (!kind) {
      continue;
    }

    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  return counts;
}

function buildTrajectoryLaneDebug({
  lane,
  episodes,
  pairs,
  debugMaxFamilies,
  debugMaxPairs,
  inferToolSurfaceKey,
}: {
  lane: PrimaryLane;
  episodes: Array<Record<string, unknown>>;
  pairs: TrajectoryPairLike[];
  debugMaxFamilies: number;
  debugMaxPairs: number;
  inferToolSurfaceKey: (familySignature: string) => string;
}): TrajectoryLaneDebug {
  const episodeById = new Map<string, Record<string, unknown>>();
  for (const episode of episodes) {
    const episodeId = typeof episode.id === "string" ? episode.id : "";
    if (!episodeId) {
      continue;
    }
    episodeById.set(episodeId, episode);
  }

  const debugPairs: TrajectoryDebugPair[] = pairs.map((pair, index) => {
    const rawFamilySignature = pair.familySignature;
    const familyId = debugFamilyId(rawFamilySignature);
    const familySignature = sanitizeDebugText(rawFamilySignature).slice(0, 240);
    const toolSurface = inferToolSurfaceKey(rawFamilySignature);

    const pairIdSource =
      typeof pair.id === "string" && pair.id.trim()
        ? pair.id
        : `${rawFamilySignature}-${index + 1}`;
    const pairId = sha256Hex(pairIdSource).slice(0, 16);

    const offStartedAt =
      typeof pair.offStartedAt === "string" && pair.offStartedAt.trim()
        ? pair.offStartedAt
        : null;
    const onStartedAt =
      typeof pair.onStartedAt === "string" && pair.onStartedAt.trim()
        ? pair.onStartedAt
        : null;

    const offEpisodeId = typeof pair.offEpisodeId === "string" ? pair.offEpisodeId : "";
    const onEpisodeId = typeof pair.onEpisodeId === "string" ? pair.onEpisodeId : "";

    const offEpisode = offEpisodeId ? episodeById.get(offEpisodeId) : undefined;
    const onEpisode = onEpisodeId ? episodeById.get(onEpisodeId) : undefined;

    const issueKindsOff = issueKindCountsFromEpisode(offEpisode);
    const issueKindsOn = issueKindCountsFromEpisode(onEpisode);

    return {
      pairId,
      familyId,
      familySignature,
      toolSurface,
      offSessionId: pair.offSessionId,
      onSessionId: pair.onSessionId,
      offStartedAt,
      onStartedAt,
      totalRetriesOff: pair.totalRetriesOff,
      totalRetriesOn: pair.totalRetriesOn,
      harmfulRetriesOff: pair.harmfulRetriesOff,
      harmfulRetriesOn: pair.harmfulRetriesOn,
      benignRetriesOff: pair.benignRetriesOff,
      benignRetriesOn: pair.benignRetriesOn,
      abstainedRetriesOff: pair.abstainedRetriesOff,
      abstainedRetriesOn: pair.abstainedRetriesOn,
      wallTimeOffMs: pair.wallTimeOffMs,
      wallTimeOnMs: pair.wallTimeOnMs,
      tokenCountOff: pair.tokenCountOff,
      tokenCountOn: pair.tokenCountOn,
      tokenProxyOff: pair.tokenProxyOff,
      tokenProxyOn: pair.tokenProxyOn,
      costOffUsd: pair.costOffUsd,
      costOnUsd: pair.costOnUsd,
      successOff: pair.successOff,
      successOn: pair.successOn,
      qualityScore:
        typeof pair.qualityScore === "number" && Number.isFinite(pair.qualityScore)
          ? pair.qualityScore
          : null,
      issueKindsOff,
      issueKindsOn,
      deltas: {
        harmfulRetriesDelta: pair.harmfulRetriesOn - pair.harmfulRetriesOff,
        wallTimeDeltaMs: pair.wallTimeOnMs - pair.wallTimeOffMs,
        tokenCountDelta: pair.tokenCountOn - pair.tokenCountOff,
      },
    };
  });

  type FamilyTotals = TrajectoryDebugFamily["totals"] & { pairCount: number };

  const totalsByFamily = new Map<string, FamilyTotals>();
  const signatureByFamily = new Map<
    string,
    {
      signature: string;
      toolSurface: string;
    }
  >();
  const issueKindsOffByFamily = new Map<string, TrajectoryIssueKindCounts>();
  const issueKindsOnByFamily = new Map<string, TrajectoryIssueKindCounts>();

  for (const pair of debugPairs) {
    const existing = totalsByFamily.get(pair.familyId);
    const next: FamilyTotals = existing ?? {
      pairCount: 0,
      totalRetriesOff: 0,
      totalRetriesOn: 0,
      harmfulRetriesOff: 0,
      harmfulRetriesOn: 0,
      benignRetriesOff: 0,
      benignRetriesOn: 0,
      abstainedRetriesOff: 0,
      abstainedRetriesOn: 0,
      wallTimeOffMs: 0,
      wallTimeOnMs: 0,
      tokenCountOff: 0,
      tokenCountOn: 0,
      tokenProxyOff: 0,
      tokenProxyOn: 0,
      costOffUsd: 0,
      costOnUsd: 0,
    };

    next.pairCount += 1;
    next.totalRetriesOff += pair.totalRetriesOff;
    next.totalRetriesOn += pair.totalRetriesOn;
    next.harmfulRetriesOff += pair.harmfulRetriesOff;
    next.harmfulRetriesOn += pair.harmfulRetriesOn;
    next.benignRetriesOff += pair.benignRetriesOff;
    next.benignRetriesOn += pair.benignRetriesOn;
    next.abstainedRetriesOff += pair.abstainedRetriesOff;
    next.abstainedRetriesOn += pair.abstainedRetriesOn;
    next.wallTimeOffMs += pair.wallTimeOffMs;
    next.wallTimeOnMs += pair.wallTimeOnMs;
    next.tokenCountOff += pair.tokenCountOff;
    next.tokenCountOn += pair.tokenCountOn;
    next.tokenProxyOff += pair.tokenProxyOff;
    next.tokenProxyOn += pair.tokenProxyOn;
    next.costOffUsd += pair.costOffUsd;
    next.costOnUsd += pair.costOnUsd;

    totalsByFamily.set(pair.familyId, next);

    if (!signatureByFamily.has(pair.familyId)) {
      signatureByFamily.set(pair.familyId, {
        signature: pair.familySignature,
        toolSurface: pair.toolSurface,
      });
    }

    const existingOffKinds = issueKindsOffByFamily.get(pair.familyId);
    const nextOffKinds = existingOffKinds
      ? { ...existingOffKinds }
      : emptyIssueKindCounts();
    addIssueKindCounts(nextOffKinds, pair.issueKindsOff);
    issueKindsOffByFamily.set(pair.familyId, nextOffKinds);

    const existingOnKinds = issueKindsOnByFamily.get(pair.familyId);
    const nextOnKinds = existingOnKinds
      ? { ...existingOnKinds }
      : emptyIssueKindCounts();
    addIssueKindCounts(nextOnKinds, pair.issueKindsOn);
    issueKindsOnByFamily.set(pair.familyId, nextOnKinds);
  }

  const families: TrajectoryDebugFamily[] = [];
  for (const [familyId, totals] of totalsByFamily.entries()) {
    const signature = signatureByFamily.get(familyId)?.signature ?? familyId;
    const toolSurface = signatureByFamily.get(familyId)?.toolSurface ?? "other";

    const judgeableRetriesOff = Math.max(
      0,
      totals.totalRetriesOff - totals.abstainedRetriesOff,
    );
    const judgeableRetriesOn = Math.max(
      0,
      totals.totalRetriesOn - totals.abstainedRetriesOn,
    );

    const judgeableCoverageOff =
      totals.totalRetriesOff <= 0 ? 1 : judgeableRetriesOff / totals.totalRetriesOff;
    const judgeableCoverageOn =
      totals.totalRetriesOn <= 0 ? 1 : judgeableRetriesOn / totals.totalRetriesOn;

    families.push({
      familyId,
      familySignature: signature,
      toolSurface,
      pairCount: totals.pairCount,
      totals: {
        totalRetriesOff: totals.totalRetriesOff,
        totalRetriesOn: totals.totalRetriesOn,
        harmfulRetriesOff: totals.harmfulRetriesOff,
        harmfulRetriesOn: totals.harmfulRetriesOn,
        benignRetriesOff: totals.benignRetriesOff,
        benignRetriesOn: totals.benignRetriesOn,
        abstainedRetriesOff: totals.abstainedRetriesOff,
        abstainedRetriesOn: totals.abstainedRetriesOn,
        wallTimeOffMs: totals.wallTimeOffMs,
        wallTimeOnMs: totals.wallTimeOnMs,
        tokenCountOff: totals.tokenCountOff,
        tokenCountOn: totals.tokenCountOn,
        tokenProxyOff: totals.tokenProxyOff,
        tokenProxyOn: totals.tokenProxyOn,
        costOffUsd: totals.costOffUsd,
        costOnUsd: totals.costOnUsd,
      },
      judgeableCoverage: {
        off: judgeableCoverageOff,
        on: judgeableCoverageOn,
      },
      deltas: {
        relativeHarmfulRetryReduction: safeRelativeReduction(
          totals.harmfulRetriesOff,
          totals.harmfulRetriesOn,
        ),
        relativeWallTimeReduction: safeRelativeReduction(
          totals.wallTimeOffMs,
          totals.wallTimeOnMs,
        ),
        relativeTokenCountReduction: safeRelativeReduction(
          totals.tokenCountOff,
          totals.tokenCountOn,
        ),
      },
      issueKindsOff: issueKindsOffByFamily.get(familyId) ?? emptyIssueKindCounts(),
      issueKindsOn: issueKindsOnByFamily.get(familyId) ?? emptyIssueKindCounts(),
    });
  }

  const familiesByPairCount = [...families].sort((left, right) => {
    if (left.pairCount !== right.pairCount) {
      return right.pairCount - left.pairCount;
    }
    return left.familyId < right.familyId ? -1 : 1;
  });

  const familiesByHarmfulReduction = [...families].sort((left, right) => {
    const diff =
      left.deltas.relativeHarmfulRetryReduction -
      right.deltas.relativeHarmfulRetryReduction;
    if (diff !== 0) {
      return diff;
    }
    if (left.pairCount !== right.pairCount) {
      return right.pairCount - left.pairCount;
    }
    return left.familyId < right.familyId ? -1 : 1;
  });

  const familiesByWallTime = [...families].sort((left, right) => {
    const diff =
      left.deltas.relativeWallTimeReduction - right.deltas.relativeWallTimeReduction;
    if (diff !== 0) {
      return diff;
    }
    if (left.pairCount !== right.pairCount) {
      return right.pairCount - left.pairCount;
    }
    return left.familyId < right.familyId ? -1 : 1;
  });

  const familiesByTokenCount = [...families].sort((left, right) => {
    const diff =
      left.deltas.relativeTokenCountReduction -
      right.deltas.relativeTokenCountReduction;
    if (diff !== 0) {
      return diff;
    }
    if (left.pairCount !== right.pairCount) {
      return right.pairCount - left.pairCount;
    }
    return left.familyId < right.familyId ? -1 : 1;
  });

  const pairsByHarmfulDelta = [...debugPairs].sort((left, right) => {
    if (left.deltas.harmfulRetriesDelta !== right.deltas.harmfulRetriesDelta) {
      return right.deltas.harmfulRetriesDelta - left.deltas.harmfulRetriesDelta;
    }
    return left.pairId < right.pairId ? -1 : 1;
  });

  const pairsByWallTimeDelta = [...debugPairs].sort((left, right) => {
    if (left.deltas.wallTimeDeltaMs !== right.deltas.wallTimeDeltaMs) {
      return right.deltas.wallTimeDeltaMs - left.deltas.wallTimeDeltaMs;
    }
    return left.pairId < right.pairId ? -1 : 1;
  });

  const pairsByTokenCountDelta = [...debugPairs].sort((left, right) => {
    if (left.deltas.tokenCountDelta !== right.deltas.tokenCountDelta) {
      return right.deltas.tokenCountDelta - left.deltas.tokenCountDelta;
    }
    return left.pairId < right.pairId ? -1 : 1;
  });

  const familyLimit =
    debugMaxFamilies <= 0 ? familiesByPairCount.length : debugMaxFamilies;
  const pairLimit = debugMaxPairs <= 0 ? debugPairs.length : debugMaxPairs;

  return {
    lane,
    pairCount: debugPairs.length,
    familyCount: families.length,
    families: takeLimited(familiesByPairCount, familyLimit),
    topFamiliesByPairCount: takeLimited(familiesByPairCount, Math.min(25, familyLimit)),
    worstFamiliesByHarmfulRetryReduction: takeLimited(
      familiesByHarmfulReduction,
      Math.min(25, familyLimit),
    ),
    worstFamiliesByWallTimeReduction: takeLimited(
      familiesByWallTime,
      Math.min(25, familyLimit),
    ),
    worstFamiliesByTokenCountReduction: takeLimited(
      familiesByTokenCount,
      Math.min(25, familyLimit),
    ),
    worstPairsByHarmfulRetriesDelta: takeLimited(
      pairsByHarmfulDelta,
      Math.min(50, pairLimit),
    ),
    worstPairsByWallTimeDelta: takeLimited(
      pairsByWallTimeDelta,
      Math.min(50, pairLimit),
    ),
    worstPairsByTokenCountDelta: takeLimited(
      pairsByTokenCountDelta,
      Math.min(50, pairLimit),
    ),
  };
}

export function buildTrajectoryOutcomeDebugReport({
  primaryLane,
  fullEvalEpisodes,
  fullEvalPairs,
  familyDisjointEpisodes,
  familyDisjointPairs,
  generatedAtUtc,
  traceRoot,
  format,
  toolName,
  debugMaxFamilies,
  debugMaxPairs,
  inferToolSurfaceKey,
}: {
  primaryLane: PrimaryLane;
  fullEvalEpisodes: Array<Record<string, unknown>>;
  fullEvalPairs: TrajectoryPairLike[];
  familyDisjointEpisodes: Array<Record<string, unknown>>;
  familyDisjointPairs: TrajectoryPairLike[];
  generatedAtUtc: string;
  traceRoot: string;
  format: string;
  toolName: string;
  debugMaxFamilies: number;
  debugMaxPairs: number;
  inferToolSurfaceKey: (familySignature: string) => string;
}): TrajectoryOutcomeDebugReport {
  return {
    schemaVersion: 1,
    generatedAtUtc,
    traceRoot,
    format,
    toolName,
    primaryLane,
    lanes: {
      full_eval: buildTrajectoryLaneDebug({
        lane: "full_eval",
        episodes: fullEvalEpisodes,
        pairs: fullEvalPairs,
        debugMaxFamilies,
        debugMaxPairs,
        inferToolSurfaceKey,
      }),
      family_disjoint_eval: buildTrajectoryLaneDebug({
        lane: "family_disjoint_eval",
        episodes: familyDisjointEpisodes,
        pairs: familyDisjointPairs,
        debugMaxFamilies,
        debugMaxPairs,
        inferToolSurfaceKey,
      }),
    },
  };
}
