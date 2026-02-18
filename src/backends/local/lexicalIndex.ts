import type { TraceIndex } from "../../core/interfaces.js";
import type { IndexedDocument, SearchQuery, SearchResult } from "../../core/types.js";

export interface InMemoryLexicalIndexOptions {
  bm25K1?: number;
  bm25B?: number;
  maxQueryTerms?: number;
}

const DEFAULT_BM25_K1 = 1.2;
const DEFAULT_BM25_B = 0.75;
const DEFAULT_MAX_QUERY_TERMS = 128;
const QUERY_TERM_HEAD_PORTION = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./:-]+/)
    .filter((token) => token.length > 1);
}

function boundedQueryTerms(terms: string[], maxQueryTerms: number): string[] {
  if (terms.length <= maxQueryTerms) {
    return terms;
  }

  const bounded: string[] = [];
  const seen = new Set<string>();
  const headLimit = Math.max(1, Math.floor(maxQueryTerms * QUERY_TERM_HEAD_PORTION));
  const tailLimit = Math.max(0, maxQueryTerms - headLimit);

  for (const term of terms) {
    if (bounded.length >= headLimit) {
      break;
    }

    if (seen.has(term)) {
      continue;
    }

    seen.add(term);
    bounded.push(term);
  }

  if (tailLimit <= 0) {
    return bounded;
  }

  const tailTerms: string[] = [];
  for (let index = terms.length - 1; index >= 0; index -= 1) {
    if (tailTerms.length >= tailLimit) {
      break;
    }

    const term = terms[index];
    if (!term) {
      continue;
    }

    if (seen.has(term)) {
      continue;
    }

    seen.add(term);
    tailTerms.push(term);
  }

  tailTerms.reverse();
  return [...bounded, ...tailTerms];
}

function metadataMatches(
  metadata: Record<string, string | number | boolean | null> | undefined,
  filters: Record<string, string | number | boolean> | undefined,
): boolean {
  if (!filters) {
    return true;
  }
  if (!metadata) {
    return false;
  }

  for (const [key, value] of Object.entries(filters)) {
    if (metadata[key] !== value) {
      return false;
    }
  }

  return true;
}

function bm25InverseDocumentFrequency(
  totalDocs: number,
  documentFrequency: number,
): number {
  return Math.log(
    1 + (totalDocs - documentFrequency + 0.5) / (documentFrequency + 0.5),
  );
}

function bm25TermWeight(
  termFrequency: number,
  documentLength: number,
  averageDocumentLength: number,
  k1: number,
  b: number,
): number {
  const safeAverageDocumentLength = Math.max(averageDocumentLength, 1);
  const normalizedDocumentLength =
    1 - b + (b * documentLength) / safeAverageDocumentLength;

  const numerator = termFrequency * (k1 + 1);
  const denominator = termFrequency + k1 * normalizedDocumentLength;
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

export class InMemoryLexicalIndex implements TraceIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly documentLengths = new Map<string, number>();

  private totalDocumentLength = 0;

  private readonly bm25K1: number;
  private readonly bm25B: number;
  private readonly maxQueryTerms: number;

  constructor(options: InMemoryLexicalIndexOptions = {}) {
    this.bm25K1 = options.bm25K1 ?? DEFAULT_BM25_K1;
    this.bm25B = options.bm25B ?? DEFAULT_BM25_B;
    this.maxQueryTerms = Math.max(
      16,
      Math.floor(options.maxQueryTerms ?? DEFAULT_MAX_QUERY_TERMS),
    );
  }

  async upsert(document: IndexedDocument): Promise<void> {
    const existing = this.documents.get(document.id);
    if (existing) {
      this.removePostings(existing);
    }

    this.documents.set(document.id, document);
    this.addPostings(document);
  }

  async upsertMany(documents: IndexedDocument[]): Promise<void> {
    for (const document of documents) {
      await this.upsert(document);
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const limit = query.limit ?? 10;
    const queryTerms = boundedQueryTerms(tokenize(query.text), this.maxQueryTerms);
    if (queryTerms.length === 0 || this.documents.size === 0) {
      return [];
    }

    const queryTermCounts = new Map<string, number>();
    for (const term of queryTerms) {
      queryTermCounts.set(term, (queryTermCounts.get(term) ?? 0) + 1);
    }

    const scores = new Map<string, number>();
    const totalDocs = this.documents.size;
    const averageDocumentLength = this.totalDocumentLength / totalDocs;

    for (const [term, queryTermFrequency] of queryTermCounts) {
      const docsForTerm = this.postings.get(term);
      if (!docsForTerm) {
        continue;
      }

      const inverseDocFrequency = bm25InverseDocumentFrequency(
        totalDocs,
        docsForTerm.size,
      );

      for (const [docId, termFrequency] of docsForTerm) {
        const document = this.documents.get(docId);
        if (!document) {
          continue;
        }

        if (!metadataMatches(document.metadata, query.filters)) {
          continue;
        }

        const documentLength = this.documentLengths.get(docId) ?? 0;
        const termScore =
          inverseDocFrequency *
          bm25TermWeight(
            termFrequency,
            documentLength,
            averageDocumentLength,
            this.bm25K1,
            this.bm25B,
          );

        const previous = scores.get(docId) ?? 0;
        scores.set(docId, previous + termScore * queryTermFrequency);
      }
    }

    const results: SearchResult[] = [];
    for (const [docId, score] of scores) {
      const document = this.documents.get(docId);
      if (!document) {
        continue;
      }
      results.push({
        document,
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private addPostings(document: IndexedDocument): void {
    const termCounts = new Map<string, number>();
    let documentLength = 0;

    for (const term of tokenize(document.text)) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
      documentLength += 1;
    }

    this.documentLengths.set(document.id, documentLength);
    this.totalDocumentLength += documentLength;

    for (const [term, frequency] of termCounts) {
      const docsForTerm = this.postings.get(term) ?? new Map<string, number>();
      docsForTerm.set(document.id, frequency);
      this.postings.set(term, docsForTerm);
    }
  }

  private removePostings(document: IndexedDocument): void {
    const existingLength = this.documentLengths.get(document.id) ?? 0;
    this.totalDocumentLength = Math.max(0, this.totalDocumentLength - existingLength);
    this.documentLengths.delete(document.id);

    const uniqueTerms = new Set(tokenize(document.text));
    for (const term of uniqueTerms) {
      const docsForTerm = this.postings.get(term);
      if (!docsForTerm) {
        continue;
      }

      docsForTerm.delete(document.id);
      if (docsForTerm.size === 0) {
        this.postings.delete(term);
      }
    }
  }
}
