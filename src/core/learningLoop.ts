import { DefaultEventDocumentBuilder } from "./documentBuilder.js";
import type {
  EventDocumentBuilder,
  SearchResultReranker,
  TraceIndex,
  TraceMiner,
  TraceStore,
} from "./interfaces.js";
import type {
  LearningSuggestion,
  MinedArtifact,
  SearchQuery,
  SearchResult,
  TraceEvent,
  TraceQuery,
} from "./types.js";

export interface LearningLoopOptions {
  store: TraceStore;
  index: TraceIndex;
  miner?: TraceMiner;
  documentBuilder?: EventDocumentBuilder;
  resultReranker?: SearchResultReranker;
}

export interface BootstrapFromStoreResult {
  eventCount: number;
  documentCount: number;
}

export interface BootstrapFromStoreOptions {
  force?: boolean;
}

export class LearningLoop {
  private readonly store: TraceStore;
  private readonly index: TraceIndex;
  private readonly miner?: TraceMiner;
  private readonly documentBuilder: EventDocumentBuilder;
  private readonly resultReranker?: SearchResultReranker;
  private hasBootstrappedFromStore = false;

  constructor(options: LearningLoopOptions) {
    this.store = options.store;
    this.index = options.index;
    this.miner = options.miner;
    this.documentBuilder = options.documentBuilder ?? new DefaultEventDocumentBuilder();
    this.resultReranker = options.resultReranker;
  }

  async ingest(event: TraceEvent): Promise<void> {
    await this.store.append(event);

    const docs = this.documentBuilder.build(event);
    if (docs.length > 0) {
      await this.index.upsertMany(docs);
    }

    if (this.miner) {
      await this.miner.ingest(event);
    }
  }

  async bootstrapFromStore(
    query: TraceQuery = {},
    options: BootstrapFromStoreOptions = {},
  ): Promise<BootstrapFromStoreResult> {
    if (this.hasBootstrappedFromStore && !options.force) {
      return {
        eventCount: 0,
        documentCount: 0,
      };
    }

    const events = await this.store.query(query);
    let documentCount = 0;

    for (const event of events) {
      const docs = this.documentBuilder.build(event);
      documentCount += docs.length;

      if (docs.length > 0) {
        await this.index.upsertMany(docs);
      }

      if (this.miner) {
        await this.miner.ingest(event);
      }
    }

    this.hasBootstrappedFromStore = true;

    return {
      eventCount: events.length,
      documentCount,
    };
  }

  async retrieve(query: SearchQuery): Promise<SearchResult[]> {
    const initialResults = await this.index.search(query);

    if (!this.resultReranker) {
      return initialResults;
    }

    const rerankedResults = await this.resultReranker(query, initialResults);
    return this.normalizeRerankedResults(initialResults, rerankedResults, query.limit);
  }

  private normalizeRerankedResults(
    initialResults: SearchResult[],
    rerankedResults: SearchResult[],
    limit: number | undefined,
  ): SearchResult[] {
    if (rerankedResults.length === 0) {
      return initialResults;
    }

    const byDocumentId = new Map<string, SearchResult>();
    for (const result of initialResults) {
      byDocumentId.set(result.document.id, result);
    }

    const normalized: SearchResult[] = [];
    const seenDocumentIds = new Set<string>();

    for (const candidate of rerankedResults) {
      const candidateId = candidate.document.id;
      const initial = byDocumentId.get(candidateId);
      if (!initial) {
        continue;
      }
      if (seenDocumentIds.has(candidateId)) {
        continue;
      }

      normalized.push(candidate);
      seenDocumentIds.add(candidateId);
    }

    for (const initial of initialResults) {
      const candidateId = initial.document.id;
      if (seenDocumentIds.has(candidateId)) {
        continue;
      }

      normalized.push(initial);
      seenDocumentIds.add(candidateId);
    }

    if (limit === undefined) {
      return normalized;
    }

    return normalized.slice(0, Math.max(0, limit));
  }

  async mine(limit = 20): Promise<MinedArtifact[]> {
    if (!this.miner) {
      return [];
    }
    return this.miner.mine(limit);
  }

  async suggest(query: SearchQuery): Promise<LearningSuggestion[]> {
    const retrieval = await this.retrieve(query);
    const suggestions: LearningSuggestion[] = [];

    const topRetrieval = retrieval.slice(0, 5);
    for (const [index, hit] of topRetrieval.entries()) {
      suggestions.push({
        id: `retrieval-${index}-${hit.document.id}`,
        title: "Related prior trace",
        rationale: `Matched with score ${hit.score.toFixed(2)}.`,
        confidence: Math.min(0.95, hit.score / 10),
        evidenceEventIds: [hit.document.sourceEventId],
        playbookMarkdown: `- Re-check: ${hit.document.text.slice(0, 220)}\n- Validate with tests before applying.`,
      });
    }

    const mined = await this.mine(5);
    for (const artifact of mined) {
      suggestions.push({
        id: `artifact-${artifact.id}`,
        title: "Learned wrong-turn correction",
        rationale: artifact.summary,
        confidence: artifact.confidence,
        evidenceEventIds: artifact.evidenceEventIds,
        playbookMarkdown: `- Pattern: ${artifact.summary}\n- Confidence: ${(artifact.confidence * 100).toFixed(0)}%`,
      });
    }

    return suggestions;
  }
}
