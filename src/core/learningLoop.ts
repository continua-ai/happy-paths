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
const MAX_MINED_ARTIFACT_SUGGESTIONS = 1;
const MIN_RETRIEVAL_CONFIDENCE = 0.2;
const MIN_FAILURE_WARNING_CONFIDENCE = 0.2;
const MIN_MISMATCH_WARNING_CONFIDENCE = 0.12;
const MIN_ARTIFACT_SUPPORT_COUNT = 2;
const MIN_ARTIFACT_SUPPORT_SESSION_COUNT = 2;
const WEAK_RETRIEVAL_CONFIDENCE_THRESHOLD = 0.45;
const MAX_READ_HINTS_WHEN_COMMAND_HINTS_EXIST = 1;

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
  confidenceScale: number;
  command: string | null;
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

const JSON_FIELD_SCAN_MAX_CHARS = 8_000;
const JSON_FIELD_VALUE_SCAN_MAX_CHARS = 4_000;

function jsonStringFieldFromDocumentText(
  text: string,
  fieldName: string,
): string | null {
  const scannedText =
    text.length <= JSON_FIELD_SCAN_MAX_CHARS
      ? text
      : text.slice(0, JSON_FIELD_SCAN_MAX_CHARS);
  const fieldPrefix = `"${fieldName}":"`;
  const fieldStart = scannedText.indexOf(fieldPrefix);
  if (fieldStart < 0) {
    return null;
  }

  let index = fieldStart + fieldPrefix.length;
  let escaped = false;
  let encodedValue = "";

  while (index < scannedText.length) {
    const character = scannedText[index];
    if (!character) {
      break;
    }

    if (escaped) {
      encodedValue += character;
      escaped = false;
      index += 1;
      if (encodedValue.length >= JSON_FIELD_VALUE_SCAN_MAX_CHARS) {
        break;
      }
      continue;
    }

    if (character === "\\") {
      encodedValue += character;
      escaped = true;
      index += 1;
      if (encodedValue.length >= JSON_FIELD_VALUE_SCAN_MAX_CHARS) {
        break;
      }
      continue;
    }

    if (character === '"') {
      break;
    }

    encodedValue += character;
    index += 1;
    if (encodedValue.length >= JSON_FIELD_VALUE_SCAN_MAX_CHARS) {
      break;
    }
  }

  if (!encodedValue) {
    return null;
  }

  return decodeEscapedWhitespace(decodeJsonString(encodedValue));
}

function commandFromDocumentText(text: string): string | null {
  const payload = parsePayloadObjectFromDocumentText(text);
  if (payload) {
    if (typeof payload.command === "string") {
      return decodeEscapedWhitespace(payload.command);
    }

    return null;
  }

  return jsonStringFieldFromDocumentText(text, "command");
}

function payloadTextFromDocumentText(text: string): string | null {
  const payload = parsePayloadObjectFromDocumentText(text);
  if (payload) {
    if (typeof payload.text === "string") {
      const value = decodeEscapedWhitespace(payload.text);
      return value || null;
    }

    return null;
  }

  const value = jsonStringFieldFromDocumentText(text, "text");
  return value && value.length > 0 ? value : null;
}

function isLowSignalCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const trivialPatterns = [
    /^(ls|pwd|whoami|date)(\s|$)/,
    /^(echo|cat|head|tail|wc)(\s|$)/,
    /^git\s+status(\s|$)/,
  ];

  if (trivialPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const broadTestCommandPattern =
    /^(?:python\s+-m\s+)?(?:pytest|npm\s+(?:run\s+)?test|pnpm\s+test|yarn\s+test|go\s+test|pants\s+test)(\s|$)/;

  if (!broadTestCommandPattern.test(normalized)) {
    return false;
  }

  const targetedMarkers = [
    /\s-k\s+\S+/,
    /\s--maxfail(?:=|\s)\d+/,
    /\s--filter\s+\S+/,
    /\s--grep\s+\S+/,
    /\s--\s+--\S+/,
    /\//,
    /::/,
  ];

  const hasTargetMarker = targetedMarkers.some((pattern) => {
    return pattern.test(normalized);
  });

  return !hasTargetMarker;
}

function isEnvironmentSensitiveReplayCommand(command: string): boolean {
  return (
    /sys\.path\s*=\s*\[p\s+for\s+p\s+in\s+sys\.path\s+if\s+p\s+not\s+in\s*\(''\s*,\s*os\.getcwd\(\)\)\]/i.test(
      command,
    ) ||
    /django\.__file__/i.test(command) ||
    /\/swebench_pi_workspaces_/i.test(command)
  );
}

function commandConfidenceScale(command: string): number {
  if (isLowSignalCommand(command)) {
    return 0.15;
  }

  return 1;
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

function buildFailureOnlySearchQuery(query: SearchQuery): SearchQuery | null {
  const filters = query.filters;
  if (!filters || filters.eventType !== "tool_result") {
    return null;
  }

  if (filters.isError !== false) {
    return null;
  }

  return {
    ...query,
    limit: Math.max(
      query.limit ?? RETRIEVAL_SUGGESTION_LIMIT,
      RETRIEVAL_SUGGESTION_LIMIT,
    ),
    filters: {
      ...filters,
      isError: true,
    },
  };
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
        confidenceScale: 1,
        command,
      };
    }

    return {
      rationale: `Prior run used \`${clippedCommand}\` in a similar context with a non-error tool result.`,
      action: `Try \`${clippedCommand}\` and validate the result before proceeding.`,
      actionKey: `command:${command.toLowerCase()}`,
      confidenceScale: commandConfidenceScale(command),
      command,
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
        confidenceScale: 1,
        command: null,
      };
    }

    return {
      rationale: `Prior tool result noted: ${clipForHint(payloadText)}.`,
      action:
        "Re-run a focused check around this symptom and verify with a targeted test.",
      actionKey: `payload:${payloadText.slice(0, 60).toLowerCase()}`,
      confidenceScale: 1,
      command: null,
    };
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (kind === "failure_warning") {
    return {
      rationale: `Prior trace signal showed a likely failure: ${clipForHint(normalized)}.`,
      action:
        "Treat this as a warning and verify assumptions before repeating the same approach.",
      actionKey: `failure-text:${normalized.slice(0, 60).toLowerCase()}`,
      confidenceScale: 1,
      command: null,
    };
  }

  return {
    rationale: `Prior trace signal: ${clipForHint(normalized)}.`,
    action: "Use this as context, then validate with a concrete command/test.",
    actionKey: `text:${normalized.slice(0, 60).toLowerCase()}`,
    confidenceScale: 1,
    command: null,
  };
}

function retrievalConfidence(score: number, topScore: number): number {
  if (score <= 0 || topScore <= 0) {
    return 0;
  }

  const normalized = score / topScore;
  return Math.max(0, Math.min(0.95, normalized));
}

const COMMAND_ENV_MISMATCH_PATTERNS: RegExp[] = [
  /command not found/i,
  /not recognized as an internal or external command/i,
  /no such file or directory/i,
  /file not found/i,
  /cannot find module/i,
  /no module named/i,
  /module not found/i,
  /modulenotfounderror/i,
  /importerror/i,
  /unknown option/i,
  /unknown argument/i,
  /unrecognized argument/i,
  /missing required argument/i,
  /permission denied/i,
  /executable file not found/i,
  /no matches found/i,
  /could not locate/i,
];

function verifyFirstAction(command: string | null): string {
  const clippedCommand = command ? clipForHint(command, 90) : null;
  if (clippedCommand) {
    return `Run a focused verification around \`${clippedCommand}\` first (command/env/context), then apply changes only after it confirms the hypothesis.`;
  }

  return "Run a focused verification first (command/env/context), then apply changes only after the check confirms the hypothesis.";
}

function actionForRetrievalHint(hint: RetrievalHint, confidence: number): string {
  if (confidence < WEAK_RETRIEVAL_CONFIDENCE_THRESHOLD) {
    return verifyFirstAction(hint.command);
  }

  return hint.action;
}

function isCommandOrEnvironmentMismatchSignal(hit: SearchResult): boolean {
  const command = commandFromDocumentText(hit.document.text) ?? "";
  const payloadText = payloadTextFromDocumentText(hit.document.text) ?? "";
  const combined = `${command}\n${payloadText}\n${hit.document.text}`;

  return COMMAND_ENV_MISMATCH_PATTERNS.some((pattern) => pattern.test(combined));
}

function artifactMetadataNumber(artifact: MinedArtifact, key: string): number {
  const value = artifact.metadata?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function artifactSupportCount(artifact: MinedArtifact): number {
  const metadataCount = artifactMetadataNumber(artifact, "supportCount");
  if (metadataCount > 0) {
    return metadataCount;
  }

  return Math.max(1, Math.floor(artifact.evidenceEventIds.length / 2));
}

function artifactSupportSessionCount(artifact: MinedArtifact): number {
  const metadataCount = artifactMetadataNumber(artifact, "supportSessionCount");
  if (metadataCount > 0) {
    return metadataCount;
  }

  return 1;
}

function artifactSupportWeight(artifact: MinedArtifact): number {
  const countSupport = artifactSupportCount(artifact);
  const sessionSupport = artifactSupportSessionCount(artifact);

  const countWeight = Math.min(1, (countSupport - 1) / 4);
  const sessionWeight = Math.min(1, (sessionSupport - 1) / 2);
  return Math.max(0, Math.min(1, (countWeight + sessionWeight) / 2));
}

function hasStrongArtifactSupport(artifact: MinedArtifact): boolean {
  const countSupport = artifactSupportCount(artifact);
  const sessionSupport = artifactSupportSessionCount(artifact);

  if (sessionSupport >= MIN_ARTIFACT_SUPPORT_SESSION_COUNT) {
    return true;
  }

  return countSupport >= Math.max(3, MIN_ARTIFACT_SUPPORT_COUNT + 1);
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
    const failureOnlyQuery = buildFailureOnlySearchQuery(query);
    const failureLaneRetrieval = failureOnlyQuery
      ? await this.retrieve(failureOnlyQuery)
      : [];

    const suggestions: LearningSuggestion[] = [];

    const byEventId = new Map<string, SearchResult>();
    for (const hit of [...retrieval, ...failureLaneRetrieval]) {
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
    const topFailureScore = failureRetrieval[0]?.score ?? 0;
    const seenActionKeys = new Set<string>();
    const seenPositiveActionKeys = new Set<string>();

    const deprioritizedCandidates: Array<{
      hit: SearchResult;
      hint: RetrievalHint;
      confidence: number;
    }> = [];

    const positiveCandidates: Array<{
      hit: SearchResult;
      hint: RetrievalHint;
      confidence: number;
      isReadPayloadHint: boolean;
    }> = [];

    for (const hit of nonFailureRetrieval) {
      const hint = retrievalHintFromText(hit.document.text, "positive");
      if (seenPositiveActionKeys.has(hint.actionKey)) {
        continue;
      }

      if (hint.command && isEnvironmentSensitiveReplayCommand(hint.command)) {
        continue;
      }

      const baseConfidence = retrievalConfidence(hit.score, topNonFailureScore);
      if (baseConfidence < MIN_RETRIEVAL_CONFIDENCE) {
        continue;
      }

      const confidence = baseConfidence * hint.confidenceScale;
      if (confidence < MIN_RETRIEVAL_CONFIDENCE) {
        if (hint.confidenceScale < 1) {
          deprioritizedCandidates.push({
            hit,
            hint,
            confidence,
          });
        }
        continue;
      }

      seenPositiveActionKeys.add(hint.actionKey);
      positiveCandidates.push({
        hit,
        hint,
        confidence,
        isReadPayloadHint:
          hint.command === null && hit.document.metadata?.toolName === "read",
      });
    }

    const commandBearingCandidates = positiveCandidates.filter((candidate) => {
      return candidate.hint.command !== null;
    });
    const payloadCandidates = positiveCandidates.filter((candidate) => {
      return candidate.hint.command === null;
    });

    const commandBearingHintsAvailable = commandBearingCandidates.length > 0;
    let selectedReadPayloadHintCount = 0;

    for (const candidate of [...commandBearingCandidates, ...payloadCandidates]) {
      if (seenActionKeys.has(candidate.hint.actionKey)) {
        continue;
      }

      if (
        candidate.isReadPayloadHint &&
        commandBearingHintsAvailable &&
        selectedReadPayloadHintCount >= MAX_READ_HINTS_WHEN_COMMAND_HINTS_EXIST
      ) {
        continue;
      }

      seenActionKeys.add(candidate.hint.actionKey);
      suggestions.push({
        id: `retrieval-${suggestions.length}-${candidate.hit.document.id}`,
        title: "Related prior tool result",
        rationale: candidate.hint.rationale,
        confidence: candidate.confidence,
        evidenceEventIds: [candidate.hit.document.sourceEventId],
        playbookMarkdown: `- Action: ${actionForRetrievalHint(
          candidate.hint,
          candidate.confidence,
        )}\n- Validate with targeted checks before applying broad changes.`,
      });

      if (candidate.isReadPayloadHint) {
        selectedReadPayloadHintCount += 1;
      }

      if (suggestions.length >= RETRIEVAL_SUGGESTION_LIMIT) {
        break;
      }
    }

    let hasFailureWarningSuggestion = false;

    const mismatchFailureCandidate = failureRetrieval.find((hit) => {
      const confidence = retrievalConfidence(hit.score, topFailureScore);
      return (
        confidence >= MIN_MISMATCH_WARNING_CONFIDENCE &&
        isCommandOrEnvironmentMismatchSignal(hit)
      );
    });

    if (mismatchFailureCandidate) {
      const hint = retrievalHintFromText(
        mismatchFailureCandidate.document.text,
        "failure_warning",
      );
      if (!seenActionKeys.has(hint.actionKey)) {
        seenActionKeys.add(hint.actionKey);
        suggestions.unshift({
          id: `retrieval-failure-warning-${mismatchFailureCandidate.document.id}`,
          title: "Prior failure warning",
          rationale: `${hint.rationale} Command/env mismatch patterns were seen in similar failures.`,
          confidence: Math.min(
            0.75,
            Math.max(
              0.25,
              retrievalConfidence(mismatchFailureCandidate.score, topFailureScore),
            ),
          ),
          evidenceEventIds: [mismatchFailureCandidate.document.sourceEventId],
          playbookMarkdown: `- Action: ${verifyFirstAction(hint.command)}\n- Confirm the root cause has changed before retrying.`,
        });
        hasFailureWarningSuggestion = true;
      }
    }

    const shouldInjectFailureWarningFromFailureLane =
      failureOnlyQuery !== null && failureLaneRetrieval.length > 0;

    if (
      !hasFailureWarningSuggestion &&
      failureRetrieval.length > 0 &&
      (suggestions.length === 0 || shouldInjectFailureWarningFromFailureLane)
    ) {
      const fallbackFailure = failureRetrieval[0];
      if (fallbackFailure) {
        const confidence = retrievalConfidence(fallbackFailure.score, topFailureScore);
        if (confidence >= MIN_FAILURE_WARNING_CONFIDENCE) {
          const hint = retrievalHintFromText(
            fallbackFailure.document.text,
            "failure_warning",
          );
          if (!seenActionKeys.has(hint.actionKey)) {
            seenActionKeys.add(hint.actionKey);
            suggestions.push({
              id: `retrieval-failure-warning-${fallbackFailure.document.id}`,
              title: "Prior failure warning",
              rationale: hint.rationale,
              confidence: Math.min(0.7, Math.max(0.2, confidence)),
              evidenceEventIds: [fallbackFailure.document.sourceEventId],
              playbookMarkdown: `- Action: ${verifyFirstAction(hint.command)}\n- Confirm the root cause has changed before retrying.`,
            });
            hasFailureWarningSuggestion = true;
          }
        }
      }
    }

    if (suggestions.length === 0 && deprioritizedCandidates.length > 0) {
      deprioritizedCandidates.sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }
        return left.hit.document.id.localeCompare(right.hit.document.id);
      });

      const fallback = deprioritizedCandidates[0];
      if (fallback) {
        suggestions.push({
          id: `retrieval-low-signal-${fallback.hit.document.id}`,
          title: "Low-signal prior tool result",
          rationale: fallback.hint.rationale,
          confidence: Math.max(0.15, fallback.confidence),
          evidenceEventIds: [fallback.hit.document.sourceEventId],
          playbookMarkdown: `- Action: ${verifyFirstAction(
            fallback.hint.command,
          )}\n- This prior command looked low-signal; prefer narrow diagnostics over direct retries.`,
        });
      }
    }

    if (suggestions.length === 0) {
      const mined = await this.mine(10);
      const candidateArtifacts = mined
        .filter((artifact) => hasStrongArtifactSupport(artifact))
        .map((artifact) => {
          const supportCount = artifactSupportCount(artifact);
          const supportSessionCount = artifactSupportSessionCount(artifact);
          const weightedConfidence = Math.min(
            0.9,
            Math.max(
              0.2,
              artifact.confidence * (0.7 + artifactSupportWeight(artifact)),
            ),
          );

          return {
            artifact,
            supportCount,
            supportSessionCount,
            weightedConfidence,
          };
        })
        .sort((left, right) => {
          if (right.supportSessionCount !== left.supportSessionCount) {
            return right.supportSessionCount - left.supportSessionCount;
          }
          if (right.supportCount !== left.supportCount) {
            return right.supportCount - left.supportCount;
          }
          if (right.weightedConfidence !== left.weightedConfidence) {
            return right.weightedConfidence - left.weightedConfidence;
          }
          return left.artifact.id.localeCompare(right.artifact.id);
        })
        .slice(0, MAX_MINED_ARTIFACT_SUGGESTIONS);

      for (const candidate of candidateArtifacts) {
        suggestions.push({
          id: `artifact-${candidate.artifact.id}`,
          title: "Learned wrong-turn correction",
          rationale: `${candidate.artifact.summary} (support: ${candidate.supportSessionCount} session(s), ${candidate.supportCount} occurrence(s)).`,
          confidence: candidate.weightedConfidence,
          evidenceEventIds: candidate.artifact.evidenceEventIds,
          playbookMarkdown: `- Pattern: ${candidate.artifact.summary}\n- Support: ${candidate.supportSessionCount} session(s), ${candidate.supportCount} occurrence(s)\n- Action: ${verifyFirstAction(null)}`,
        });
      }

      if (
        suggestions.length === 0 &&
        (dedupedRetrieval.length > 0 || mined.length > 0)
      ) {
        suggestions.push({
          id: "retrieval-verify-first-fallback",
          title: "Verify-first fallback",
          rationale:
            "Prior retrieval evidence was weak or low-support. Start with targeted diagnostics before applying broad corrective actions.",
          confidence: 0.2,
          evidenceEventIds: [],
          playbookMarkdown: `- Action: ${verifyFirstAction(
            null,
          )}\n- Prefer narrow reproductions and environment checks first.`,
        });
      }
    }

    const dedupedSuggestions: LearningSuggestion[] = [];
    const seenEvidenceKeys = new Set<string>();

    for (const suggestion of suggestions.slice(0, RETRIEVAL_SUGGESTION_LIMIT)) {
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
