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

const RETRIEVAL_SUGGESTION_LIMIT = 5;
const MIN_RETRIEVAL_CONFIDENCE = 0.15;

function clipForHint(text: string, maxLength = 180): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function decodeEscapedWhitespace(text: string): string {
  return text.replace(/\\n/g, " ").replace(/\\t/g, " ").replace(/\s+/g, " ").trim();
}

function commandFromDocumentText(text: string): string | null {
  const match = /"command":"([^"]+)"/.exec(text);
  if (!match?.[1]) {
    return null;
  }
  return decodeEscapedWhitespace(match[1]);
}

function payloadTextFromDocumentText(text: string): string | null {
  const match = /"text":"([^"]+)"/.exec(text);
  if (!match?.[1]) {
    return null;
  }

  const value = decodeEscapedWhitespace(match[1]);
  if (!value) {
    return null;
  }

  return value;
}

function retrievalHintFromText(text: string): { rationale: string; action: string } {
  const command = commandFromDocumentText(text);
  if (command) {
    return {
      rationale: `Prior run used \`${clipForHint(command, 90)}\` in a similar context.`,
      action: `Try \`${clipForHint(command, 90)}\` and validate the result before proceeding.`,
    };
  }

  const payloadText = payloadTextFromDocumentText(text);
  if (payloadText) {
    return {
      rationale: `Prior tool result noted: ${clipForHint(payloadText)}.`,
      action:
        "Re-run a focused check around this symptom and verify with a targeted test.",
    };
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  return {
    rationale: `Prior trace signal: ${clipForHint(normalized)}.`,
    action: "Use this as context, then validate with a concrete command/test.",
  };
}

function retrievalConfidence(score: number, topScore: number): number {
  if (score <= 0 || topScore <= 0) {
    return 0;
  }

  const normalized = score / topScore;
  return Math.max(0, Math.min(0.95, normalized));
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

    const byEventId = new Map<string, SearchResult>();
    for (const hit of retrieval) {
      const key = hit.document.sourceEventId;
      if (!byEventId.has(key)) {
        byEventId.set(key, hit);
      }
    }

    const dedupedRetrieval = [...byEventId.values()];
    const topScore = dedupedRetrieval[0]?.score ?? 0;

    for (const hit of dedupedRetrieval) {
      const confidence = retrievalConfidence(hit.score, topScore);
      if (confidence < MIN_RETRIEVAL_CONFIDENCE) {
        continue;
      }

      const hint = retrievalHintFromText(hit.document.text);
      suggestions.push({
        id: `retrieval-${suggestions.length}-${hit.document.id}`,
        title: "Related prior tool result",
        rationale: hint.rationale,
        confidence,
        evidenceEventIds: [hit.document.sourceEventId],
        playbookMarkdown: `- Action: ${hint.action}\n- Validate with targeted tests/checks before applying.`,
      });

      if (suggestions.length >= RETRIEVAL_SUGGESTION_LIMIT) {
        break;
      }
    }

    if (suggestions.length === 0 && dedupedRetrieval.length > 0) {
      const fallback = dedupedRetrieval[0];
      if (fallback) {
        const hint = retrievalHintFromText(fallback.document.text);
        suggestions.push({
          id: `retrieval-fallback-${fallback.document.id}`,
          title: "Related prior tool result",
          rationale: hint.rationale,
          confidence: Math.max(0.05, retrievalConfidence(fallback.score, topScore)),
          evidenceEventIds: [fallback.document.sourceEventId],
          playbookMarkdown: `- Action: ${hint.action}\n- Validate with targeted tests/checks before applying.`,
        });
      }
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

    const dedupedSuggestions: LearningSuggestion[] = [];
    const seenEvidenceKeys = new Set<string>();

    for (const suggestion of suggestions) {
      const evidenceKey = suggestion.evidenceEventIds.slice().sort().join("|");
      const key = `${suggestion.title}|${evidenceKey}`;
      if (seenEvidenceKeys.has(key)) {
        continue;
      }
      seenEvidenceKeys.add(key);
      dedupedSuggestions.push(suggestion);
    }

    return dedupedSuggestions;
  }
}
