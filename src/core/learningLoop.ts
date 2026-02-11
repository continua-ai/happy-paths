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
const MIN_RETRIEVAL_CONFIDENCE = 0.2;
const MIN_FAILURE_WARNING_CONFIDENCE = 0.2;

function clipForHint(text: string, maxLength = 180): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

type ToolResultOutcome = "success" | "failure" | "unknown";

type RetrievalHintKind = "positive" | "failure_warning";

interface RetrievalHint {
  rationale: string;
  action: string;
  actionKey: string;
}

function decodeEscapedWhitespace(text: string): string {
  return text.replace(/\\n/g, " ").replace(/\\t/g, " ").replace(/\s+/g, " ").trim();
}

function decodeJsonString(value: string): string {
  try {
    const decoded = JSON.parse(`"${value}"`) as unknown;
    if (typeof decoded === "string") {
      return decoded;
    }
  } catch {
    // Fall through to best-effort unescape handling.
  }
  return value;
}

function parsePayloadObjectFromDocumentText(
  text: string,
): Record<string, unknown> | null {
  const objectStart = text.indexOf("{");
  if (objectStart < 0) {
    return null;
  }

  const candidate = text.slice(objectStart);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function jsonStringFieldFromDocumentText(
  text: string,
  fieldName: string,
): string | null {
  const pattern = new RegExp(`"${fieldName}":"((?:\\\\.|[^\"])+)"`);
  const match = pattern.exec(text);
  if (!match?.[1]) {
    return null;
  }

  return decodeEscapedWhitespace(decodeJsonString(match[1]));
}

function commandFromDocumentText(text: string): string | null {
  const payload = parsePayloadObjectFromDocumentText(text);
  if (payload && typeof payload.command === "string") {
    return decodeEscapedWhitespace(payload.command);
  }

  return jsonStringFieldFromDocumentText(text, "command");
}

function payloadTextFromDocumentText(text: string): string | null {
  const payload = parsePayloadObjectFromDocumentText(text);
  if (payload && typeof payload.text === "string") {
    const value = decodeEscapedWhitespace(payload.text);
    return value || null;
  }

  const value = jsonStringFieldFromDocumentText(text, "text");
  return value && value.length > 0 ? value : null;
}

function toolResultOutcomeFromSearchResult(hit: SearchResult): ToolResultOutcome {
  const metadata = hit.document.metadata;
  if (metadata?.eventType !== "tool_result") {
    return "unknown";
  }

  if (metadata.isError === true || metadata.outcome === "failure") {
    return "failure";
  }

  if (metadata.isError === false || metadata.outcome === "success") {
    return "success";
  }

  return "unknown";
}

function retrievalHintFromText(text: string, kind: RetrievalHintKind): RetrievalHint {
  const command = commandFromDocumentText(text);
  if (command) {
    const clippedCommand = clipForHint(command, 90);
    if (kind === "failure_warning") {
      return {
        rationale: `Prior run hit an error after \`${clippedCommand}\` in a similar context.`,
        action: `Avoid retrying \`${clippedCommand}\` unchanged; verify the root cause has changed first.`,
        actionKey: `failure-command:${command.toLowerCase()}`,
      };
    }

    return {
      rationale: `Prior run used \`${clippedCommand}\` in a similar context with a non-error tool result.`,
      action: `Try \`${clippedCommand}\` and validate the result before proceeding.`,
      actionKey: `command:${command.toLowerCase()}`,
    };
  }

  const payloadText = payloadTextFromDocumentText(text);
  if (payloadText) {
    if (kind === "failure_warning") {
      return {
        rationale: `Prior tool result reported an error: ${clipForHint(payloadText)}.`,
        action:
          "Before retrying, confirm the underlying condition changed and run a narrower diagnostic first.",
        actionKey: `failure-payload:${payloadText.slice(0, 60).toLowerCase()}`,
      };
    }

    return {
      rationale: `Prior tool result noted: ${clipForHint(payloadText)}.`,
      action:
        "Re-run a focused check around this symptom and verify with a targeted test.",
      actionKey: `payload:${payloadText.slice(0, 60).toLowerCase()}`,
    };
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (kind === "failure_warning") {
    return {
      rationale: `Prior trace signal showed a likely failure: ${clipForHint(normalized)}.`,
      action:
        "Treat this as a warning and verify assumptions before repeating the same approach.",
      actionKey: `failure-text:${normalized.slice(0, 60).toLowerCase()}`,
    };
  }

  return {
    rationale: `Prior trace signal: ${clipForHint(normalized)}.`,
    action: "Use this as context, then validate with a concrete command/test.",
    actionKey: `text:${normalized.slice(0, 60).toLowerCase()}`,
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
    const nonFailureRetrieval = dedupedRetrieval.filter((hit) => {
      return toolResultOutcomeFromSearchResult(hit) !== "failure";
    });
    const failureRetrieval = dedupedRetrieval.filter((hit) => {
      return toolResultOutcomeFromSearchResult(hit) === "failure";
    });

    const topNonFailureScore = nonFailureRetrieval[0]?.score ?? 0;
    const seenActionKeys = new Set<string>();

    for (const hit of nonFailureRetrieval) {
      const confidence = retrievalConfidence(hit.score, topNonFailureScore);
      if (confidence < MIN_RETRIEVAL_CONFIDENCE) {
        continue;
      }

      const hint = retrievalHintFromText(hit.document.text, "positive");
      if (seenActionKeys.has(hint.actionKey)) {
        continue;
      }
      seenActionKeys.add(hint.actionKey);

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

    if (suggestions.length === 0 && failureRetrieval.length > 0) {
      const fallbackFailure = failureRetrieval[0];
      const topFailureScore = failureRetrieval[0]?.score ?? 0;
      if (fallbackFailure) {
        const confidence = retrievalConfidence(fallbackFailure.score, topFailureScore);
        if (confidence >= MIN_FAILURE_WARNING_CONFIDENCE) {
          const hint = retrievalHintFromText(
            fallbackFailure.document.text,
            "failure_warning",
          );
          suggestions.push({
            id: `retrieval-failure-warning-${fallbackFailure.document.id}`,
            title: "Prior failure warning",
            rationale: hint.rationale,
            confidence: Math.min(0.7, Math.max(0.2, confidence)),
            evidenceEventIds: [fallbackFailure.document.sourceEventId],
            playbookMarkdown: `- Action: ${hint.action}\n- Confirm the root cause has changed before retrying.`,
          });
        }
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
