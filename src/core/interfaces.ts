import type {
  IndexedDocument,
  LearningSuggestion,
  MinedArtifact,
  SearchQuery,
  SearchResult,
  TraceEvent,
  TraceQuery,
} from "./types.js";

export interface TraceStore {
  append(event: TraceEvent): Promise<void>;
  appendMany(events: TraceEvent[]): Promise<void>;
  query(query: TraceQuery): Promise<TraceEvent[]>;
}

export interface TraceIndex {
  upsert(document: IndexedDocument): Promise<void>;
  upsertMany(documents: IndexedDocument[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
}

export interface TraceMiner {
  ingest(event: TraceEvent): Promise<void>;
  mine(limit?: number): Promise<MinedArtifact[]>;
}

export interface EventDocumentBuilder {
  build(event: TraceEvent): IndexedDocument[];
}

export interface LearningAdvisor {
  suggest(query: SearchQuery): Promise<LearningSuggestion[]>;
}

export type SearchResultReranker = (
  query: SearchQuery,
  results: SearchResult[],
) => Promise<SearchResult[]> | SearchResult[];
