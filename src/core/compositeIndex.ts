import type { TraceIndex } from "./interfaces.js";
import type { IndexedDocument, SearchQuery, SearchResult } from "./types.js";

export interface CompositeTraceIndexOptions {
  primary: TraceIndex;
  secondary?: TraceIndex;
  reciprocalRankFusionK?: number;
  primaryWeight?: number;
  secondaryWeight?: number;
}

interface RankedHit {
  document: IndexedDocument;
  fusedScore: number;
  primaryRank: number | null;
  secondaryRank: number | null;
}

const DEFAULT_RRF_K = 60;
const DEFAULT_PRIMARY_WEIGHT = 1.25;
const DEFAULT_SECONDARY_WEIGHT = 1;

function normalizeSourceWeight(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Source weight must be a finite positive number, got: ${value}`);
  }

  return value;
}

function comparableRank(rank: number | null): number {
  return rank ?? Number.MAX_SAFE_INTEGER;
}

export class CompositeTraceIndex implements TraceIndex {
  private readonly primary: TraceIndex;
  private readonly secondary?: TraceIndex;
  private readonly reciprocalRankFusionK: number;
  private readonly primaryWeight: number;
  private readonly secondaryWeight: number;

  constructor(options: CompositeTraceIndexOptions) {
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.reciprocalRankFusionK = options.reciprocalRankFusionK ?? DEFAULT_RRF_K;
    this.primaryWeight = normalizeSourceWeight(
      options.primaryWeight,
      DEFAULT_PRIMARY_WEIGHT,
    );
    this.secondaryWeight = normalizeSourceWeight(
      options.secondaryWeight,
      DEFAULT_SECONDARY_WEIGHT,
    );
  }

  async upsert(document: IndexedDocument): Promise<void> {
    await this.primary.upsert(document);
    if (this.secondary) {
      await this.secondary.upsert(document);
    }
  }

  async upsertMany(documents: IndexedDocument[]): Promise<void> {
    await this.primary.upsertMany(documents);
    if (this.secondary) {
      await this.secondary.upsertMany(documents);
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (!this.secondary) {
      return this.primary.search(query);
    }

    const limit = query.limit ?? 10;
    const fanoutLimit = Math.max(limit, 20);

    const [primaryResults, secondaryResults] = await Promise.all([
      this.primary.search({ ...query, limit: fanoutLimit }),
      this.secondary.search({ ...query, limit: fanoutLimit }),
    ]);

    return this.fuse(primaryResults, secondaryResults, limit);
  }

  private fuse(
    primaryResults: SearchResult[],
    secondaryResults: SearchResult[],
    limit: number,
  ): SearchResult[] {
    const byDocumentId = new Map<string, RankedHit>();

    const addRankedResult = (
      result: SearchResult,
      rank: number,
      source: "primary" | "secondary",
    ) => {
      const sourceWeight =
        source === "primary" ? this.primaryWeight : this.secondaryWeight;
      const reciprocalRank = sourceWeight / (this.reciprocalRankFusionK + rank + 1);
      const existing = byDocumentId.get(result.document.id);

      if (existing) {
        existing.fusedScore += reciprocalRank;
        if (source === "primary") {
          existing.primaryRank =
            existing.primaryRank === null ? rank : Math.min(existing.primaryRank, rank);
        } else {
          existing.secondaryRank =
            existing.secondaryRank === null
              ? rank
              : Math.min(existing.secondaryRank, rank);
        }
        return;
      }

      byDocumentId.set(result.document.id, {
        document: result.document,
        fusedScore: reciprocalRank,
        primaryRank: source === "primary" ? rank : null,
        secondaryRank: source === "secondary" ? rank : null,
      });
    };

    for (const [rank, result] of primaryResults.entries()) {
      addRankedResult(result, rank, "primary");
    }
    for (const [rank, result] of secondaryResults.entries()) {
      addRankedResult(result, rank, "secondary");
    }

    return Array.from(byDocumentId.values())
      .sort((left, right) => {
        if (right.fusedScore !== left.fusedScore) {
          return right.fusedScore - left.fusedScore;
        }

        const primaryRankDiff =
          comparableRank(left.primaryRank) - comparableRank(right.primaryRank);
        if (primaryRankDiff !== 0) {
          return primaryRankDiff;
        }

        const secondaryRankDiff =
          comparableRank(left.secondaryRank) - comparableRank(right.secondaryRank);
        if (secondaryRankDiff !== 0) {
          return secondaryRankDiff;
        }

        if (left.document.id < right.document.id) {
          return -1;
        }
        if (left.document.id > right.document.id) {
          return 1;
        }
        return 0;
      })
      .slice(0, limit)
      .map((hit) => {
        return {
          document: hit.document,
          score: hit.fusedScore,
        };
      });
  }
}
