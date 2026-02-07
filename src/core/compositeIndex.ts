import type { TraceIndex } from "./interfaces.js";
import type { IndexedDocument, SearchQuery, SearchResult } from "./types.js";

export interface CompositeTraceIndexOptions {
  primary: TraceIndex;
  secondary?: TraceIndex;
  reciprocalRankFusionK?: number;
}

interface RankedHit {
  document: IndexedDocument;
  fusedScore: number;
}

const DEFAULT_RRF_K = 60;

export class CompositeTraceIndex implements TraceIndex {
  private readonly primary: TraceIndex;
  private readonly secondary?: TraceIndex;
  private readonly reciprocalRankFusionK: number;

  constructor(options: CompositeTraceIndexOptions) {
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.reciprocalRankFusionK = options.reciprocalRankFusionK ?? DEFAULT_RRF_K;
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

    const addRankedResult = (result: SearchResult, rank: number) => {
      const reciprocalRank = 1 / (this.reciprocalRankFusionK + rank + 1);
      const existing = byDocumentId.get(result.document.id);

      if (existing) {
        existing.fusedScore += reciprocalRank;
        return;
      }

      byDocumentId.set(result.document.id, {
        document: result.document,
        fusedScore: reciprocalRank,
      });
    };

    for (const [rank, result] of primaryResults.entries()) {
      addRankedResult(result, rank);
    }
    for (const [rank, result] of secondaryResults.entries()) {
      addRankedResult(result, rank);
    }

    return Array.from(byDocumentId.values())
      .sort((left, right) => right.fusedScore - left.fusedScore)
      .slice(0, limit)
      .map((hit) => {
        return {
          document: hit.document,
          score: hit.fusedScore,
        };
      });
  }
}
