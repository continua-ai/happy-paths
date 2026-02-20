import { randomUUID } from "node:crypto";
import type { LearningLoop } from "../../core/learningLoop.js";
import {
  type ProjectIdentityOverrides,
  resolveProjectIdentity,
} from "../../core/projectIdentity.js";
import type { LearningSuggestion, TraceScope } from "../../core/types.js";
import type {
  PiBeforeAgentStartEvent,
  PiInputEvent,
  PiLikeApi,
  PiToolCallEvent,
  PiToolResultEvent,
  PiTurnEndEvent,
  PiTurnStartEvent,
} from "./types.js";

interface ToolCallState {
  toolName: string;
  input: Record<string, unknown>;
}

type SuggestionRetrievalScope = "swebench_instance" | "global";

type SuggestionRetrievalOutcomeFilter = "non_error" | "any";

interface SuggestionRetrievalPlan {
  filters: Record<string, string | boolean>;
  retrievalScope: SuggestionRetrievalScope;
  outcomeFilter: SuggestionRetrievalOutcomeFilter;
  fallbackToGlobalToolResults: boolean;
}

type HintMode = "all" | "artifact_only";

export interface PiTraceExtensionOptions {
  loop: LearningLoop;
  retrievalLoop?: LearningLoop;
  scope?: TraceScope;
  harnessName?: string;
  agentId?: string;
  sessionId?: string;
  maxSuggestions?: number;
  hintMode?: HintMode;
  suggestionQueryMaxChars?: number;
  suggestionPlanTimeoutMs?: number;
  suggestionTotalTimeoutMs?: number;
  customMessageType?: string;
  projectIdentity?: ProjectIdentityOverrides;
}

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_SUGGESTION_QUERY_MAX_CHARS = 1_200;
const DEFAULT_SUGGESTION_PLAN_TIMEOUT_MS = 1_500;
const DEFAULT_SUGGESTION_TOTAL_TIMEOUT_MS = 4_000;

type TimedAsyncResult<T> =
  | {
      kind: "value";
      value: T;
    }
  | {
      kind: "error";
      error: Error;
    }
  | {
      kind: "timeout";
    };

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

async function runWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<TimedAsyncResult<T>> {
  if (timeoutMs <= 0) {
    try {
      return {
        kind: "value",
        value: await run(),
      };
    } catch (error) {
      return {
        kind: "error",
        error: normalizeError(error),
      };
    }
  }

  let timeoutHandle: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<TimedAsyncResult<T>>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });

  const valuePromise = run()
    .then((value) => {
      return {
        kind: "value" as const,
        value,
      };
    })
    .catch((error: unknown) => {
      return {
        kind: "error" as const,
        error: normalizeError(error),
      };
    });

  const settled = await Promise.race([valuePromise, timeoutPromise]);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  return settled;
}

function boundedSuggestionQueryText(options: {
  prompt: string;
  maxChars: number;
}): {
  text: string;
  truncated: boolean;
} {
  const normalized = options.prompt.replace(/\s+/g, " ").trim();
  const maxChars = Math.max(512, Math.floor(options.maxChars));

  if (normalized.length <= maxChars) {
    return {
      text: normalized,
      truncated: false,
    };
  }

  const separator = " ... ";
  const headLength = Math.max(300, Math.floor(maxChars * 0.65));
  const tailLength = Math.max(160, maxChars - headLength - separator.length);

  const head = normalized.slice(0, headLength).trimEnd();
  const tail = normalized.slice(-tailLength).trimStart();

  return {
    text: `${head}${separator}${tail}`,
    truncated: true,
  };
}

function extractText(result: PiToolResultEvent): string {
  const textFromContent = (result.content ?? [])
    .map((chunk) => chunk.text)
    .join("\n")
    .trim();

  if (textFromContent) {
    return textFromContent;
  }

  if (result.details) {
    try {
      return JSON.stringify(result.details);
    } catch {
      return "";
    }
  }

  return "";
}

function commandFromInput(input: Record<string, unknown>): string | undefined {
  const command = input.command;
  if (typeof command === "string") {
    return command;
  }
  return undefined;
}

function swebenchInstanceIdFromSessionId(sessionId: string): string | null {
  const parts = sessionId.split("::");
  if (parts.length !== 3 && parts.length !== 4) {
    return null;
  }

  if (parts[0] !== "swebench") {
    return null;
  }

  const instanceId = parts[1]?.trim() ?? "";
  if (!instanceId) {
    return null;
  }

  return instanceId;
}

function firstPlaybookAction(playbookMarkdown: string): string | null {
  const firstLine = playbookMarkdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return null;
  }

  const withoutPrefix = firstLine.startsWith("- ") ? firstLine.slice(2) : firstLine;
  const withoutActionLabel = withoutPrefix.replace(/^Action:\s*/i, "");
  return withoutActionLabel.trim() || null;
}

function rankSuggestionsByConfidence(
  suggestions: LearningSuggestion[],
): LearningSuggestion[] {
  return [...suggestions].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.id.localeCompare(right.id);
  });
}

function isArtifactSuggestion(suggestion: LearningSuggestion): boolean {
  return (
    suggestion.id.startsWith("artifact-") ||
    suggestion.title === "Learned wrong-turn correction"
  );
}

const HINT_POLICY_VERSION = "v3_frozen_single_hint_utility";
const MIN_ARTIFACT_HINT_CONFIDENCE = 0.45;
const MIN_FAILURE_WARNING_HINT_CONFIDENCE = 0.2;
const MIN_RETRIEVAL_HINT_CONFIDENCE = 0.55;
const MIN_OTHER_HINT_CONFIDENCE = 0.6;
const MAX_HINTS_PER_TURN = 1;
const RETRIEVAL_WITH_ARTIFACT_OVERRIDE_CONFIDENCE = 0.92;
const MIN_SELECTED_HINT_UTILITY_SCORE = 0.15;
const TIMEOUT_RISK_WEIGHT = 0.65;
const TOKEN_RISK_WEIGHT = 0.35;

type SuggestionKind = "artifact" | "failure_warning" | "retrieval" | "other";

interface HintSelectionDiagnostics {
  availableHintCount: number;
  availableArtifactHintCount: number;
  availableFailureWarningHintCount: number;
  availableRetrievalHintCount: number;
  availableOtherHintCount: number;
  filteredLowConfidenceHintCount: number;
  filteredLowConfidenceArtifactHintCount: number;
  filteredLowConfidenceFailureWarningHintCount: number;
  filteredLowConfidenceRetrievalHintCount: number;
  filteredLowConfidenceOtherHintCount: number;
  filteredLowUtilityHintCount: number;
  policySuppressedByBudgetCount: number;
  policySuppressedByArtifactPriorityCount: number;
  selectedArtifactHintCount: number;
  selectedFailureWarningHintCount: number;
  selectedRetrievalHintCount: number;
  selectedOtherHintCount: number;
  selectedHintKind: SuggestionKind | null;
  selectedHintUtilityScore: number | null;
  selectionBudgetRaw: number;
  selectionBudgetApplied: number;
}

interface HintSelectionResult {
  selectedSuggestions: LearningSuggestion[];
  diagnostics: HintSelectionDiagnostics;
}

interface ScoredSuggestionCandidate {
  suggestion: LearningSuggestion;
  kind: SuggestionKind;
  utilityScore: number;
}

function isFailureWarningSuggestion(suggestion: LearningSuggestion): boolean {
  return suggestion.title === "Prior failure warning";
}

function isRetrievalSuggestion(suggestion: LearningSuggestion): boolean {
  return suggestion.id.startsWith("retrieval-");
}

function suggestionKind(suggestion: LearningSuggestion): SuggestionKind {
  if (isArtifactSuggestion(suggestion)) {
    return "artifact";
  }

  if (isFailureWarningSuggestion(suggestion)) {
    return "failure_warning";
  }

  if (isRetrievalSuggestion(suggestion)) {
    return "retrieval";
  }

  return "other";
}

function minimumConfidenceForSuggestionKind(kind: SuggestionKind): number {
  if (kind === "artifact") {
    return MIN_ARTIFACT_HINT_CONFIDENCE;
  }

  if (kind === "failure_warning") {
    return MIN_FAILURE_WARNING_HINT_CONFIDENCE;
  }

  if (kind === "retrieval") {
    return MIN_RETRIEVAL_HINT_CONFIDENCE;
  }

  return MIN_OTHER_HINT_CONFIDENCE;
}

function timeoutRiskBySuggestionKind(kind: SuggestionKind): number {
  if (kind === "artifact") {
    return 0.08;
  }

  if (kind === "failure_warning") {
    return 0.14;
  }

  if (kind === "retrieval") {
    return 0.28;
  }

  return 0.2;
}

function tokenRiskBySuggestionKind(kind: SuggestionKind): number {
  if (kind === "artifact") {
    return 0.04;
  }

  if (kind === "failure_warning") {
    return 0.06;
  }

  if (kind === "retrieval") {
    return 0.14;
  }

  return 0.1;
}

function utilityScoreForSuggestion(
  suggestion: LearningSuggestion,
  kind: SuggestionKind,
): number {
  const timeoutRisk = timeoutRiskBySuggestionKind(kind);
  const tokenRisk = tokenRiskBySuggestionKind(kind);
  return (
    suggestion.confidence -
    timeoutRisk * TIMEOUT_RISK_WEIGHT -
    tokenRisk * TOKEN_RISK_WEIGHT
  );
}

function emptyHintSelectionDiagnostics(): HintSelectionDiagnostics {
  return {
    availableHintCount: 0,
    availableArtifactHintCount: 0,
    availableFailureWarningHintCount: 0,
    availableRetrievalHintCount: 0,
    availableOtherHintCount: 0,
    filteredLowConfidenceHintCount: 0,
    filteredLowConfidenceArtifactHintCount: 0,
    filteredLowConfidenceFailureWarningHintCount: 0,
    filteredLowConfidenceRetrievalHintCount: 0,
    filteredLowConfidenceOtherHintCount: 0,
    filteredLowUtilityHintCount: 0,
    policySuppressedByBudgetCount: 0,
    policySuppressedByArtifactPriorityCount: 0,
    selectedArtifactHintCount: 0,
    selectedFailureWarningHintCount: 0,
    selectedRetrievalHintCount: 0,
    selectedOtherHintCount: 0,
    selectedHintKind: null,
    selectedHintUtilityScore: null,
    selectionBudgetRaw: 0,
    selectionBudgetApplied: 0,
  };
}

function incrementAvailableCountForKind(
  diagnostics: HintSelectionDiagnostics,
  kind: SuggestionKind,
): void {
  if (kind === "artifact") {
    diagnostics.availableArtifactHintCount += 1;
    return;
  }

  if (kind === "failure_warning") {
    diagnostics.availableFailureWarningHintCount += 1;
    return;
  }

  if (kind === "retrieval") {
    diagnostics.availableRetrievalHintCount += 1;
    return;
  }

  diagnostics.availableOtherHintCount += 1;
}

function incrementLowConfidenceCountForKind(
  diagnostics: HintSelectionDiagnostics,
  kind: SuggestionKind,
): void {
  diagnostics.filteredLowConfidenceHintCount += 1;

  if (kind === "artifact") {
    diagnostics.filteredLowConfidenceArtifactHintCount += 1;
    return;
  }

  if (kind === "failure_warning") {
    diagnostics.filteredLowConfidenceFailureWarningHintCount += 1;
    return;
  }

  if (kind === "retrieval") {
    diagnostics.filteredLowConfidenceRetrievalHintCount += 1;
    return;
  }

  diagnostics.filteredLowConfidenceOtherHintCount += 1;
}

function annotateSelectedSuggestion(
  diagnostics: HintSelectionDiagnostics,
  selected: ScoredSuggestionCandidate | null,
): void {
  if (!selected) {
    return;
  }

  diagnostics.selectedHintKind = selected.kind;
  diagnostics.selectedHintUtilityScore = selected.utilityScore;

  if (selected.kind === "artifact") {
    diagnostics.selectedArtifactHintCount = 1;
    return;
  }

  if (selected.kind === "failure_warning") {
    diagnostics.selectedFailureWarningHintCount = 1;
    return;
  }

  if (selected.kind === "retrieval") {
    diagnostics.selectedRetrievalHintCount = 1;
    return;
  }

  diagnostics.selectedOtherHintCount = 1;
}

function buildScoredCandidates(
  suggestions: LearningSuggestion[],
  diagnostics: HintSelectionDiagnostics,
): ScoredSuggestionCandidate[] {
  const scoredCandidates: ScoredSuggestionCandidate[] = [];

  for (const suggestion of rankSuggestionsByConfidence(suggestions)) {
    const kind = suggestionKind(suggestion);
    incrementAvailableCountForKind(diagnostics, kind);

    if (suggestion.confidence < minimumConfidenceForSuggestionKind(kind)) {
      incrementLowConfidenceCountForKind(diagnostics, kind);
      continue;
    }

    scoredCandidates.push({
      suggestion,
      kind,
      utilityScore: utilityScoreForSuggestion(suggestion, kind),
    });
  }

  scoredCandidates.sort((left, right) => {
    if (right.utilityScore !== left.utilityScore) {
      return right.utilityScore - left.utilityScore;
    }

    if (right.suggestion.confidence !== left.suggestion.confidence) {
      return right.suggestion.confidence - left.suggestion.confidence;
    }

    return left.suggestion.id.localeCompare(right.suggestion.id);
  });

  return scoredCandidates;
}

function selectArtifactOnlySuggestions(
  suggestions: LearningSuggestion[],
  maxSuggestions: number,
): HintSelectionResult {
  const diagnostics = emptyHintSelectionDiagnostics();
  diagnostics.availableHintCount = suggestions.length;
  diagnostics.selectionBudgetRaw = Math.max(0, maxSuggestions);
  diagnostics.selectionBudgetApplied = Math.min(
    MAX_HINTS_PER_TURN,
    diagnostics.selectionBudgetRaw,
  );

  for (const suggestion of suggestions) {
    incrementAvailableCountForKind(diagnostics, suggestionKind(suggestion));
  }

  if (diagnostics.selectionBudgetApplied <= 0 || suggestions.length === 0) {
    return {
      selectedSuggestions: [],
      diagnostics,
    };
  }

  const scoredCandidates: ScoredSuggestionCandidate[] = [];
  for (const suggestion of rankSuggestionsByConfidence(suggestions)) {
    const kind = suggestionKind(suggestion);
    if (kind !== "artifact") {
      continue;
    }

    if (suggestion.confidence < MIN_ARTIFACT_HINT_CONFIDENCE) {
      incrementLowConfidenceCountForKind(diagnostics, kind);
      continue;
    }

    scoredCandidates.push({
      suggestion,
      kind,
      utilityScore: utilityScoreForSuggestion(suggestion, kind),
    });
  }

  scoredCandidates.sort((left, right) => {
    if (right.utilityScore !== left.utilityScore) {
      return right.utilityScore - left.utilityScore;
    }

    if (right.suggestion.confidence !== left.suggestion.confidence) {
      return right.suggestion.confidence - left.suggestion.confidence;
    }

    return left.suggestion.id.localeCompare(right.suggestion.id);
  });

  const best = scoredCandidates[0] ?? null;
  if (!best) {
    return {
      selectedSuggestions: [],
      diagnostics,
    };
  }

  if (best.utilityScore < MIN_SELECTED_HINT_UTILITY_SCORE) {
    diagnostics.filteredLowUtilityHintCount = 1;
    return {
      selectedSuggestions: [],
      diagnostics,
    };
  }

  annotateSelectedSuggestion(diagnostics, best);
  diagnostics.policySuppressedByBudgetCount = Math.max(0, scoredCandidates.length - 1);

  return {
    selectedSuggestions: [best.suggestion],
    diagnostics,
  };
}

function selectTopSuggestionsWithPolicy(
  suggestions: LearningSuggestion[],
  maxSuggestions: number,
): HintSelectionResult {
  const diagnostics = emptyHintSelectionDiagnostics();
  diagnostics.availableHintCount = suggestions.length;
  diagnostics.selectionBudgetRaw = Math.max(0, maxSuggestions);
  diagnostics.selectionBudgetApplied = Math.min(
    MAX_HINTS_PER_TURN,
    diagnostics.selectionBudgetRaw,
  );

  if (diagnostics.selectionBudgetApplied <= 0 || suggestions.length === 0) {
    return {
      selectedSuggestions: [],
      diagnostics,
    };
  }

  const scoredCandidates = buildScoredCandidates(suggestions, diagnostics);
  const hasArtifactCandidate = scoredCandidates.some((candidate) => {
    return candidate.kind === "artifact";
  });

  let selected: ScoredSuggestionCandidate | null = null;

  for (const candidate of scoredCandidates) {
    if (
      hasArtifactCandidate &&
      candidate.kind === "retrieval" &&
      candidate.suggestion.confidence < RETRIEVAL_WITH_ARTIFACT_OVERRIDE_CONFIDENCE
    ) {
      diagnostics.policySuppressedByArtifactPriorityCount += 1;
      continue;
    }

    selected = candidate;
    break;
  }

  if (!selected) {
    return {
      selectedSuggestions: [],
      diagnostics,
    };
  }

  if (selected.utilityScore < MIN_SELECTED_HINT_UTILITY_SCORE) {
    diagnostics.filteredLowUtilityHintCount = 1;
    return {
      selectedSuggestions: [],
      diagnostics,
    };
  }

  annotateSelectedSuggestion(diagnostics, selected);

  const effectiveCandidateCount = Math.max(
    0,
    scoredCandidates.length - diagnostics.policySuppressedByArtifactPriorityCount,
  );
  diagnostics.policySuppressedByBudgetCount = Math.max(0, effectiveCandidateCount - 1);

  return {
    selectedSuggestions: [selected.suggestion],
    diagnostics,
  };
}

function buildSuggestionRetrievalPlans(
  swebenchInstanceId: string | null,
): SuggestionRetrievalPlan[] {
  const plans: SuggestionRetrievalPlan[] = [];

  if (swebenchInstanceId) {
    plans.push({
      filters: {
        eventType: "tool_result",
        swebenchInstanceId,
        isError: false,
      },
      retrievalScope: "swebench_instance",
      outcomeFilter: "non_error",
      fallbackToGlobalToolResults: false,
    });

    plans.push({
      filters: {
        eventType: "tool_result",
        swebenchInstanceId,
      },
      retrievalScope: "swebench_instance",
      outcomeFilter: "any",
      fallbackToGlobalToolResults: false,
    });

    plans.push({
      filters: {
        eventType: "tool_result",
        isError: false,
      },
      retrievalScope: "global",
      outcomeFilter: "non_error",
      fallbackToGlobalToolResults: true,
    });

    plans.push({
      filters: {
        eventType: "tool_result",
      },
      retrievalScope: "global",
      outcomeFilter: "any",
      fallbackToGlobalToolResults: true,
    });

    return plans;
  }

  plans.push({
    filters: {
      eventType: "tool_result",
      isError: false,
    },
    retrievalScope: "global",
    outcomeFilter: "non_error",
    fallbackToGlobalToolResults: false,
  });

  plans.push({
    filters: {
      eventType: "tool_result",
    },
    retrievalScope: "global",
    outcomeFilter: "any",
    fallbackToGlobalToolResults: false,
  });

  return plans;
}

export function createPiTraceExtension(
  options: PiTraceExtensionOptions,
): (pi: PiLikeApi) => void {
  const loop = options.loop;
  const retrievalLoop = options.retrievalLoop ?? loop;
  const retrievalMemoryMode = retrievalLoop === loop ? "live" : "frozen";
  const scope = options.scope ?? "personal";
  const harness = options.harnessName ?? "pi";
  const agentId = options.agentId;
  const maxSuggestions = options.maxSuggestions ?? 3;
  const hintMode = options.hintMode ?? "all";
  const suggestionQueryMaxChars = Math.max(
    512,
    Math.floor(options.suggestionQueryMaxChars ?? DEFAULT_SUGGESTION_QUERY_MAX_CHARS),
  );
  const suggestionPlanTimeoutMs = Math.max(
    50,
    Math.floor(options.suggestionPlanTimeoutMs ?? DEFAULT_SUGGESTION_PLAN_TIMEOUT_MS),
  );
  const suggestionTotalTimeoutMs = Math.max(
    suggestionPlanTimeoutMs,
    Math.floor(options.suggestionTotalTimeoutMs ?? DEFAULT_SUGGESTION_TOTAL_TIMEOUT_MS),
  );
  const projectIdentity = resolveProjectIdentity(options.projectIdentity);
  const customMessageType =
    options.customMessageType ?? projectIdentity.extensionCustomType;

  const sessionId = options.sessionId ?? randomUUID();
  const turnStartTimes = new Map<number, number>();
  const toolCalls = new Map<string, ToolCallState>();
  let latestUserInputEventId: string | null = null;

  async function ingest(event: {
    type:
      | "user_input"
      | "tool_call"
      | "tool_result"
      | "turn_summary"
      | "feedback"
      | "checkpoint"
      | "assistant_output";
    payload: Record<string, unknown>;
    tags?: string[];
    metrics?: {
      latencyMs?: number;
      outcome?: "success" | "failure" | "unknown";
      tokens?: {
        inputUncached?: number;
        inputCached?: number;
        output?: number;
        cacheWrite?: number;
      };
      cost?: {
        usd?: number;
      };
    };
  }): Promise<string> {
    const eventId = randomUUID();
    await loop.ingest({
      id: eventId,
      timestamp: nowIso(),
      sessionId,
      agentId,
      harness,
      scope,
      type: event.type,
      payload: event.payload,
      tags: event.tags,
      metrics: event.metrics,
    });
    return eventId;
  }

  return (pi: PiLikeApi) => {
    pi.on("input", async (rawEvent) => {
      const event = rawEvent as PiInputEvent;
      latestUserInputEventId = await ingest({
        type: "user_input",
        payload: {
          text: event.text,
          source: event.source ?? "interactive",
        },
      });
    });

    pi.on("tool_call", async (rawEvent) => {
      const event = rawEvent as PiToolCallEvent;
      toolCalls.set(event.toolCallId, {
        toolName: event.toolName,
        input: event.input,
      });

      await ingest({
        type: "tool_call",
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          command: commandFromInput(event.input),
        },
      });
    });

    pi.on("tool_result", async (rawEvent) => {
      const event = rawEvent as PiToolResultEvent;
      const call = toolCalls.get(event.toolCallId);
      const text = extractText(event);
      const isError = event.isError === true;

      await ingest({
        type: "tool_result",
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          command: call ? commandFromInput(call.input) : undefined,
          isError,
          text,
          input: event.input,
        },
        metrics: {
          outcome: isError ? "failure" : "success",
        },
      });
    });

    pi.on("turn_start", (rawEvent) => {
      const event = rawEvent as PiTurnStartEvent;
      turnStartTimes.set(event.turnIndex, Date.now());
    });

    pi.on("turn_end", async (rawEvent) => {
      const event = rawEvent as PiTurnEndEvent;
      const startedAt = turnStartTimes.get(event.turnIndex) ?? Date.now();
      const usage = event.message?.usage;

      await ingest({
        type: "turn_summary",
        payload: {
          turnIndex: event.turnIndex,
        },
        metrics: {
          latencyMs: Date.now() - startedAt,
          tokens: {
            inputUncached: usage?.input,
            inputCached: usage?.cacheRead,
            output: usage?.output,
            cacheWrite: usage?.cacheWrite,
          },
          cost: {
            usd: usage?.cost?.total,
          },
        },
      });
    });

    pi.on("before_agent_start", async (rawEvent) => {
      const event = rawEvent as PiBeforeAgentStartEvent;

      if (maxSuggestions <= 0) {
        await ingest({
          type: "checkpoint",
          payload: {
            kind: "happy_paths_prior_hints",
            hintMode,
            retrievalMemoryMode,
            hintPolicyVersion: HINT_POLICY_VERSION,
            minArtifactHintConfidence: MIN_ARTIFACT_HINT_CONFIDENCE,
            minFailureWarningHintConfidence: MIN_FAILURE_WARNING_HINT_CONFIDENCE,
            minRetrievalHintConfidence: MIN_RETRIEVAL_HINT_CONFIDENCE,
            minOtherHintConfidence: MIN_OTHER_HINT_CONFIDENCE,
            minSelectedHintUtilityScore: MIN_SELECTED_HINT_UTILITY_SCORE,
            retrievalScope: "disabled",
            retrievalOutcomeFilter: "disabled",
            fallbackToGlobalToolResults: false,
            hintCount: 0,
            retrievalHintCount: 0,
            failureWarningHintCount: 0,
            artifactHintCount: 0,
            availableHintCount: 0,
            availableFailureWarningHintCount: 0,
            availableArtifactHintCount: 0,
            availableRetrievalHintCount: 0,
            availableOtherHintCount: 0,
            filteredLowConfidenceHintCount: 0,
            filteredLowConfidenceArtifactHintCount: 0,
            filteredLowConfidenceFailureWarningHintCount: 0,
            filteredLowConfidenceRetrievalHintCount: 0,
            filteredLowConfidenceOtherHintCount: 0,
            filteredLowUtilityHintCount: 0,
            policySuppressedByBudgetCount: 0,
            policySuppressedByArtifactPriorityCount: 0,
            selectedArtifactHintCount: 0,
            selectedFailureWarningHintCount: 0,
            selectedRetrievalHintCount: 0,
            selectedOtherHintCount: 0,
            selectedHintKind: null,
            selectedHintUtilityScore: null,
            hintSelectionBudgetRaw: 0,
            hintSelectionBudgetApplied: 0,
            selfFilteredHintCount: 0,
            hintIds: [],
            hintTitles: [],
          },
          tags: ["happy_paths", "prior_hints"],
        });
        return undefined;
      }

      const suggestionQuery = boundedSuggestionQueryText({
        prompt: event.prompt,
        maxChars: suggestionQueryMaxChars,
      });

      const swebenchInstanceId = swebenchInstanceIdFromSessionId(sessionId);
      const retrievalPlans = buildSuggestionRetrievalPlans(swebenchInstanceId);

      let selectedPlan = retrievalPlans[0] ?? {
        filters: { eventType: "tool_result", isError: false },
        retrievalScope: "global" as const,
        outcomeFilter: "non_error" as const,
        fallbackToGlobalToolResults: false,
      };
      let suggestions = [] as Awaited<ReturnType<LearningLoop["suggest"]>>;
      let retrievalTimedOut = false;
      let retrievalErrorCount = 0;
      let retrievalPlansAttempted = 0;
      const retrievalStartedAtMs = Date.now();

      for (const plan of retrievalPlans) {
        const elapsedMs = Date.now() - retrievalStartedAtMs;
        const remainingBudgetMs = suggestionTotalTimeoutMs - elapsedMs;
        if (remainingBudgetMs <= 0) {
          retrievalTimedOut = true;
          break;
        }

        const planTimeoutMs = Math.max(
          50,
          Math.min(suggestionPlanTimeoutMs, remainingBudgetMs),
        );

        retrievalPlansAttempted += 1;

        const candidate = await runWithTimeout(() => {
          return retrievalLoop.suggest({
            text: suggestionQuery.text,
            limit: maxSuggestions + 2,
            filters: plan.filters,
          });
        }, planTimeoutMs);

        selectedPlan = plan;

        if (candidate.kind === "timeout") {
          retrievalTimedOut = true;
          break;
        }

        if (candidate.kind === "error") {
          retrievalErrorCount += 1;
          continue;
        }

        if (candidate.value.length > 0) {
          suggestions = candidate.value;
          break;
        }
      }

      const fallbackToGlobalToolResults = selectedPlan.fallbackToGlobalToolResults;

      const nonSelfSuggestions = suggestions.filter((suggestion) => {
        if (!latestUserInputEventId) {
          return true;
        }
        return !suggestion.evidenceEventIds.includes(latestUserInputEventId);
      });

      const selection =
        hintMode === "artifact_only"
          ? selectArtifactOnlySuggestions(nonSelfSuggestions, maxSuggestions)
          : selectTopSuggestionsWithPolicy(nonSelfSuggestions, maxSuggestions);
      const topSuggestions = selection.selectedSuggestions;

      const retrievalHintCount = topSuggestions.filter((suggestion) => {
        return suggestion.id.startsWith("retrieval-");
      }).length;
      const failureWarningHintCount = topSuggestions.filter((suggestion) => {
        return suggestion.title === "Prior failure warning";
      }).length;
      const artifactHintCount = topSuggestions.filter((suggestion) => {
        return suggestion.id.startsWith("artifact-");
      }).length;

      await ingest({
        type: "checkpoint",
        payload: {
          kind: "happy_paths_prior_hints",
          hintMode,
          retrievalMemoryMode,
          hintPolicyVersion: HINT_POLICY_VERSION,
          minArtifactHintConfidence: MIN_ARTIFACT_HINT_CONFIDENCE,
          minFailureWarningHintConfidence: MIN_FAILURE_WARNING_HINT_CONFIDENCE,
          minRetrievalHintConfidence: MIN_RETRIEVAL_HINT_CONFIDENCE,
          minOtherHintConfidence: MIN_OTHER_HINT_CONFIDENCE,
          minSelectedHintUtilityScore: MIN_SELECTED_HINT_UTILITY_SCORE,
          retrievalScope: selectedPlan.retrievalScope,
          retrievalOutcomeFilter: selectedPlan.outcomeFilter,
          fallbackToGlobalToolResults,
          retrievalPromptTruncated: suggestionQuery.truncated,
          retrievalQueryTextLength: suggestionQuery.text.length,
          retrievalPlansAttempted,
          retrievalTimedOut,
          retrievalErrorCount,
          hintCount: topSuggestions.length,
          retrievalHintCount,
          failureWarningHintCount,
          artifactHintCount,
          availableHintCount: selection.diagnostics.availableHintCount,
          availableFailureWarningHintCount:
            selection.diagnostics.availableFailureWarningHintCount,
          availableArtifactHintCount: selection.diagnostics.availableArtifactHintCount,
          availableRetrievalHintCount:
            selection.diagnostics.availableRetrievalHintCount,
          availableOtherHintCount: selection.diagnostics.availableOtherHintCount,
          filteredLowConfidenceHintCount:
            selection.diagnostics.filteredLowConfidenceHintCount,
          filteredLowConfidenceArtifactHintCount:
            selection.diagnostics.filteredLowConfidenceArtifactHintCount,
          filteredLowConfidenceFailureWarningHintCount:
            selection.diagnostics.filteredLowConfidenceFailureWarningHintCount,
          filteredLowConfidenceRetrievalHintCount:
            selection.diagnostics.filteredLowConfidenceRetrievalHintCount,
          filteredLowConfidenceOtherHintCount:
            selection.diagnostics.filteredLowConfidenceOtherHintCount,
          filteredLowUtilityHintCount:
            selection.diagnostics.filteredLowUtilityHintCount,
          policySuppressedByBudgetCount:
            selection.diagnostics.policySuppressedByBudgetCount,
          policySuppressedByArtifactPriorityCount:
            selection.diagnostics.policySuppressedByArtifactPriorityCount,
          selectedArtifactHintCount: selection.diagnostics.selectedArtifactHintCount,
          selectedFailureWarningHintCount:
            selection.diagnostics.selectedFailureWarningHintCount,
          selectedRetrievalHintCount: selection.diagnostics.selectedRetrievalHintCount,
          selectedOtherHintCount: selection.diagnostics.selectedOtherHintCount,
          selectedHintKind: selection.diagnostics.selectedHintKind,
          selectedHintUtilityScore: selection.diagnostics.selectedHintUtilityScore,
          hintSelectionBudgetRaw: selection.diagnostics.selectionBudgetRaw,
          hintSelectionBudgetApplied: selection.diagnostics.selectionBudgetApplied,
          selfFilteredHintCount: Math.max(
            0,
            suggestions.length - nonSelfSuggestions.length,
          ),
          hintIds: topSuggestions.map((suggestion) => suggestion.id),
          hintTitles: topSuggestions.map((suggestion) =>
            suggestion.title.slice(0, 160),
          ),
        },
        tags: ["happy_paths", "prior_hints"],
      });

      if (topSuggestions.length === 0) {
        return undefined;
      }

      const rendered = topSuggestions
        .map((suggestion, index) => {
          const confidencePct = Math.round(Math.max(0, suggestion.confidence) * 100);
          const action = firstPlaybookAction(suggestion.playbookMarkdown);
          const clippedAction =
            action && action.length > 120 ? `${action.slice(0, 119)}…` : action;
          const actionSuffix = clippedAction ? ` Action: ${clippedAction}` : "";
          return `${index + 1}. ${suggestion.rationale} (confidence ${confidencePct}%).${actionSuffix}`;
        })
        .join("\n");

      return {
        message: {
          customType: customMessageType,
          content: `Prior trace hints:\n${rendered}`,
          display: true,
        },
      };
    });
  };
}
