import { randomUUID } from "node:crypto";
import type { ErrorTimeHint, ErrorTimeHintMatcher } from "../../core/errorTimeHints.js";
import { formatErrorTimeHint } from "../../core/errorTimeHints.js";
import type { LearningLoop } from "../../core/learningLoop.js";
import {
  type ProjectIdentityOverrides,
  resolveProjectIdentity,
} from "../../core/projectIdentity.js";
import {
  type ToolCallHint,
  formatToolCallHint,
  matchToolCallReinvention,
} from "../../core/toolCallHints.js";
import { classifyTrajectoryIssue } from "../../core/trajectoryOutcomeGate.js";
import type {
  LearningSuggestion,
  TraceEvent,
  TraceQuery,
  TraceScope,
} from "../../core/types.js";
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
  /** Error-time hint matcher for tool_result interception. */
  errorTimeHintMatcher?: ErrorTimeHintMatcher;
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

function toFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
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

const HINT_POLICY_VERSION = "v4_contextual_harm_gate";
const MIN_ARTIFACT_HINT_CONFIDENCE = 0.45;
const MIN_FAILURE_WARNING_HINT_CONFIDENCE = 0.2;
const MIN_RETRIEVAL_HINT_CONFIDENCE = 0.55;
const MIN_OTHER_HINT_CONFIDENCE = 0.6;
const MAX_HINTS_PER_TURN = 1;
const RETRIEVAL_WITH_ARTIFACT_OVERRIDE_CONFIDENCE = 0.92;
const MIN_SELECTED_HINT_UTILITY_SCORE = 0.15;
const MIN_EXPECTED_HARMFUL_REDUCTION = 0.01;
const SIGNATURE_NEGATIVE_LIFT_THRESHOLD = -0.03;
const MIN_SIGNATURE_SESSIONS_FOR_SUPPRESSION = 2;
const CONTEXT_BANDIT_EXPLORATION_WEIGHT = 0.04;
const TIMEOUT_RISK_WEIGHT = 0.65;
const TOKEN_RISK_WEIGHT = 0.35;

type SuggestionKind = "artifact" | "failure_warning" | "retrieval" | "other";
type PolicySelectionKind = SuggestionKind | "none";

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
  filteredByHarmRiskHintCount: number;
  policySuppressedByBudgetCount: number;
  policySuppressedByArtifactPriorityCount: number;
  policySuppressedByCounterfactualCount: number;
  selectedArtifactHintCount: number;
  selectedFailureWarningHintCount: number;
  selectedRetrievalHintCount: number;
  selectedOtherHintCount: number;
  selectedHintKind: SuggestionKind | null;
  selectedHintUtilityScore: number | null;
  selectedExpectedHarmfulReductionScore: number | null;
  selectedContextualBanditScore: number | null;
  selectedHarmfulRateBaseline: number | null;
  selectedHarmfulRateForKind: number | null;
  policyContextKey: string | null;
  policyMemorySessionCount: number;
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
  expectedHarmfulReductionScore: number;
  contextualBanditScore: number;
  harmfulRateBaseline: number;
  harmfulRateForKind: number;
}

interface HintPolicyKindStats {
  sessionCount: number;
  totalFailures: number;
  harmfulFailures: number;
}

interface HintPolicyMemory {
  totalSessions: number;
  byKind: Record<PolicySelectionKind, HintPolicyKindStats>;
  byContext: Map<string, Record<PolicySelectionKind, HintPolicyKindStats>>;
  bySignature: Map<string, HintPolicyKindStats>;
}

interface HintPolicyDecision {
  allow: boolean;
  expectedHarmfulReduction: number;
  contextualBanditScore: number;
  harmfulRateBaseline: number;
  harmfulRateForKind: number;
  counterfactualSuppressed: boolean;
}

interface HintPolicyContext {
  contextKey: string;
  memory: HintPolicyMemory;
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
    filteredByHarmRiskHintCount: 0,
    policySuppressedByBudgetCount: 0,
    policySuppressedByArtifactPriorityCount: 0,
    policySuppressedByCounterfactualCount: 0,
    selectedArtifactHintCount: 0,
    selectedFailureWarningHintCount: 0,
    selectedRetrievalHintCount: 0,
    selectedOtherHintCount: 0,
    selectedHintKind: null,
    selectedHintUtilityScore: null,
    selectedExpectedHarmfulReductionScore: null,
    selectedContextualBanditScore: null,
    selectedHarmfulRateBaseline: null,
    selectedHarmfulRateForKind: null,
    policyContextKey: null,
    policyMemorySessionCount: 0,
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
  diagnostics.selectedExpectedHarmfulReductionScore =
    selected.expectedHarmfulReductionScore;
  diagnostics.selectedContextualBanditScore = selected.contextualBanditScore;
  diagnostics.selectedHarmfulRateBaseline = selected.harmfulRateBaseline;
  diagnostics.selectedHarmfulRateForKind = selected.harmfulRateForKind;

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

const POLICY_SELECTION_KINDS: PolicySelectionKind[] = [
  "none",
  "artifact",
  "failure_warning",
  "retrieval",
  "other",
];

const HARMFUL_RATE_PRIOR_COUNTS: Record<
  PolicySelectionKind,
  {
    harmfulFailures: number;
    nonHarmfulFailures: number;
  }
> = {
  none: {
    harmfulFailures: 6,
    nonHarmfulFailures: 6,
  },
  artifact: {
    harmfulFailures: 5,
    nonHarmfulFailures: 7,
  },
  failure_warning: {
    harmfulFailures: 5,
    nonHarmfulFailures: 8,
  },
  retrieval: {
    harmfulFailures: 6,
    nonHarmfulFailures: 6,
  },
  other: {
    harmfulFailures: 6,
    nonHarmfulFailures: 6,
  },
};

function emptyHintPolicyKindStats(): HintPolicyKindStats {
  return {
    sessionCount: 0,
    totalFailures: 0,
    harmfulFailures: 0,
  };
}

function emptyHintPolicyKindStatsRecord(): Record<
  PolicySelectionKind,
  HintPolicyKindStats
> {
  return {
    none: emptyHintPolicyKindStats(),
    artifact: emptyHintPolicyKindStats(),
    failure_warning: emptyHintPolicyKindStats(),
    retrieval: emptyHintPolicyKindStats(),
    other: emptyHintPolicyKindStats(),
  };
}

function normalizeHintSignatureText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function hintSignatureFromSuggestion(
  suggestion: LearningSuggestion,
  kind: SuggestionKind,
): string {
  const action = firstPlaybookAction(suggestion.playbookMarkdown);
  if (action) {
    return `${kind}:${normalizeHintSignatureText(action)}`;
  }

  return `${kind}:${normalizeHintSignatureText(suggestion.title)}`;
}

function selectedHintKindFromCheckpointPayload(
  payload: Record<string, unknown>,
): PolicySelectionKind {
  const selectedKind = payload.selectedHintKind;
  if (
    selectedKind === "artifact" ||
    selectedKind === "failure_warning" ||
    selectedKind === "retrieval" ||
    selectedKind === "other"
  ) {
    return selectedKind;
  }

  const hintCount = toFiniteNumber(payload.hintCount);
  if (hintCount <= 0) {
    return "none";
  }

  if (toFiniteNumber(payload.selectedArtifactHintCount) > 0) {
    return "artifact";
  }
  if (toFiniteNumber(payload.selectedFailureWarningHintCount) > 0) {
    return "failure_warning";
  }
  if (toFiniteNumber(payload.selectedRetrievalHintCount) > 0) {
    return "retrieval";
  }

  return "other";
}

function selectedHintSignatureFromCheckpointPayload(
  payload: Record<string, unknown>,
  kind: PolicySelectionKind,
): string | null {
  if (kind === "none") {
    return null;
  }

  const hintTitles = payload.hintTitles;
  if (
    Array.isArray(hintTitles) &&
    typeof hintTitles[0] === "string" &&
    hintTitles[0].trim().length > 0
  ) {
    return `${kind}:${normalizeHintSignatureText(hintTitles[0])}`;
  }

  const hintIds = payload.hintIds;
  if (
    Array.isArray(hintIds) &&
    typeof hintIds[0] === "string" &&
    hintIds[0].trim().length > 0
  ) {
    return `${kind}:${normalizeHintSignatureText(hintIds[0])}`;
  }

  return null;
}

function isFailureToolResultEvent(event: TraceEvent): boolean {
  if (event.type !== "tool_result") {
    return false;
  }

  if (event.metrics?.outcome === "failure") {
    return true;
  }

  return event.payload?.isError === true;
}

function hintPolicyContextKeyFromSessionId(sessionId: string): string {
  const instanceId = swebenchInstanceIdFromSessionId(sessionId);
  if (instanceId) {
    return `swebench:${instanceId}`;
  }

  return "global";
}

function accumulateHintPolicyStats(
  stats: HintPolicyKindStats,
  totalFailures: number,
  harmfulFailures: number,
): void {
  stats.sessionCount += 1;
  stats.totalFailures += totalFailures;
  stats.harmfulFailures += harmfulFailures;
}

function buildHintPolicyMemory(events: TraceEvent[]): HintPolicyMemory {
  const bySession = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const bucket = bySession.get(event.sessionId);
    if (bucket) {
      bucket.push(event);
    } else {
      bySession.set(event.sessionId, [event]);
    }
  }

  const memory: HintPolicyMemory = {
    totalSessions: 0,
    byKind: emptyHintPolicyKindStatsRecord(),
    byContext: new Map(),
    bySignature: new Map(),
  };

  for (const [sessionId, sessionEvents] of bySession.entries()) {
    let selectedKind: PolicySelectionKind = "none";
    let selectedSignature: string | null = null;
    let foundHintCheckpoint = false;
    let totalFailures = 0;
    let harmfulFailures = 0;

    for (const event of sessionEvents) {
      if (isFailureToolResultEvent(event)) {
        totalFailures += 1;
        const issue = classifyTrajectoryIssue(event);
        if (issue?.harmful) {
          harmfulFailures += 1;
        }
      }

      if (
        event.type === "checkpoint" &&
        event.payload?.kind === "happy_paths_prior_hints"
      ) {
        foundHintCheckpoint = true;
        selectedKind = selectedHintKindFromCheckpointPayload(event.payload);
        selectedSignature = selectedHintSignatureFromCheckpointPayload(
          event.payload,
          selectedKind,
        );
      }
    }

    if (!foundHintCheckpoint) {
      continue;
    }

    memory.totalSessions += 1;
    const contextKey = hintPolicyContextKeyFromSessionId(sessionId);

    accumulateHintPolicyStats(
      memory.byKind[selectedKind],
      totalFailures,
      harmfulFailures,
    );

    const contextStats =
      memory.byContext.get(contextKey) ?? emptyHintPolicyKindStatsRecord();
    accumulateHintPolicyStats(
      contextStats[selectedKind],
      totalFailures,
      harmfulFailures,
    );
    memory.byContext.set(contextKey, contextStats);

    if (selectedSignature) {
      const signatureKey = `${contextKey}|${selectedSignature}`;
      const signatureStats =
        memory.bySignature.get(signatureKey) ?? emptyHintPolicyKindStats();
      accumulateHintPolicyStats(signatureStats, totalFailures, harmfulFailures);
      memory.bySignature.set(signatureKey, signatureStats);
    }
  }

  return memory;
}

function harmfulRateFromStats(
  stats: HintPolicyKindStats,
  kind: PolicySelectionKind,
): number {
  const prior = HARMFUL_RATE_PRIOR_COUNTS[kind];
  const priorHarmful = prior.harmfulFailures;
  const priorTotal = prior.harmfulFailures + prior.nonHarmfulFailures;
  const total = priorTotal + stats.totalFailures;
  if (total <= 0) {
    return 0.5;
  }

  return (priorHarmful + stats.harmfulFailures) / total;
}

function blendedHarmfulRateEstimate(options: {
  memory: HintPolicyMemory;
  contextKey: string;
  kind: PolicySelectionKind;
}): {
  harmfulRate: number;
  sampleCount: number;
} {
  const globalStats = options.memory.byKind[options.kind];
  const globalRate = harmfulRateFromStats(globalStats, options.kind);

  const contextRecord = options.memory.byContext.get(options.contextKey);
  const contextStats = contextRecord?.[options.kind] ?? emptyHintPolicyKindStats();
  const contextRate = harmfulRateFromStats(contextStats, options.kind);

  if (contextStats.sessionCount <= 0) {
    return {
      harmfulRate: globalRate,
      sampleCount: globalStats.sessionCount,
    };
  }

  const contextWeight = Math.min(0.75, contextStats.sessionCount / 8);
  const harmfulRate = contextRate * contextWeight + globalRate * (1 - contextWeight);

  return {
    harmfulRate,
    sampleCount: contextStats.sessionCount,
  };
}

function evaluateHintPolicyDecision(options: {
  candidate: LearningSuggestion;
  kind: SuggestionKind;
  policy: HintPolicyContext;
}): HintPolicyDecision {
  const baselineEstimate = blendedHarmfulRateEstimate({
    memory: options.policy.memory,
    contextKey: options.policy.contextKey,
    kind: "none",
  });

  const kindEstimate = blendedHarmfulRateEstimate({
    memory: options.policy.memory,
    contextKey: options.policy.contextKey,
    kind: options.kind,
  });

  const expectedHarmfulReduction =
    baselineEstimate.harmfulRate - kindEstimate.harmfulRate;

  const totalSessions = Math.max(1, options.policy.memory.totalSessions);
  const explorationBonus =
    CONTEXT_BANDIT_EXPLORATION_WEIGHT *
    Math.sqrt(Math.log(totalSessions + 1) / (kindEstimate.sampleCount + 1));

  const contextualBanditScore = expectedHarmfulReduction + explorationBonus;

  let counterfactualSuppressed = false;
  const signature = hintSignatureFromSuggestion(options.candidate, options.kind);
  const signatureStats = options.policy.memory.bySignature.get(
    `${options.policy.contextKey}|${signature}`,
  );

  if (
    signatureStats &&
    signatureStats.sessionCount >= MIN_SIGNATURE_SESSIONS_FOR_SUPPRESSION
  ) {
    const signatureRate = harmfulRateFromStats(signatureStats, options.kind);
    const signatureReduction = baselineEstimate.harmfulRate - signatureRate;
    if (signatureReduction < SIGNATURE_NEGATIVE_LIFT_THRESHOLD) {
      counterfactualSuppressed = true;
    }
  }

  const allow =
    contextualBanditScore > MIN_EXPECTED_HARMFUL_REDUCTION && !counterfactualSuppressed;

  return {
    allow,
    expectedHarmfulReduction,
    contextualBanditScore,
    harmfulRateBaseline: baselineEstimate.harmfulRate,
    harmfulRateForKind: kindEstimate.harmfulRate,
    counterfactualSuppressed,
  };
}

function buildScoredCandidates(
  suggestions: LearningSuggestion[],
  diagnostics: HintSelectionDiagnostics,
  policy: HintPolicyContext,
): ScoredSuggestionCandidate[] {
  const scoredCandidates: ScoredSuggestionCandidate[] = [];
  diagnostics.policyContextKey = policy.contextKey;
  diagnostics.policyMemorySessionCount = policy.memory.totalSessions;

  for (const suggestion of rankSuggestionsByConfidence(suggestions)) {
    const kind = suggestionKind(suggestion);
    incrementAvailableCountForKind(diagnostics, kind);

    if (suggestion.confidence < minimumConfidenceForSuggestionKind(kind)) {
      incrementLowConfidenceCountForKind(diagnostics, kind);
      continue;
    }

    const decision = evaluateHintPolicyDecision({
      candidate: suggestion,
      kind,
      policy,
    });

    if (decision.counterfactualSuppressed) {
      diagnostics.policySuppressedByCounterfactualCount += 1;
      continue;
    }

    if (!decision.allow) {
      diagnostics.filteredByHarmRiskHintCount += 1;
      continue;
    }

    scoredCandidates.push({
      suggestion,
      kind,
      utilityScore: utilityScoreForSuggestion(suggestion, kind),
      expectedHarmfulReductionScore: decision.expectedHarmfulReduction,
      contextualBanditScore: decision.contextualBanditScore,
      harmfulRateBaseline: decision.harmfulRateBaseline,
      harmfulRateForKind: decision.harmfulRateForKind,
    });
  }

  scoredCandidates.sort((left, right) => {
    if (right.contextualBanditScore !== left.contextualBanditScore) {
      return right.contextualBanditScore - left.contextualBanditScore;
    }

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
  policy: HintPolicyContext,
): HintSelectionResult {
  const diagnostics = emptyHintSelectionDiagnostics();
  diagnostics.availableHintCount = suggestions.length;
  diagnostics.selectionBudgetRaw = Math.max(0, maxSuggestions);
  diagnostics.selectionBudgetApplied = Math.min(
    MAX_HINTS_PER_TURN,
    diagnostics.selectionBudgetRaw,
  );
  diagnostics.policyContextKey = policy.contextKey;
  diagnostics.policyMemorySessionCount = policy.memory.totalSessions;

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

    const decision = evaluateHintPolicyDecision({
      candidate: suggestion,
      kind,
      policy,
    });

    if (decision.counterfactualSuppressed) {
      diagnostics.policySuppressedByCounterfactualCount += 1;
      continue;
    }

    if (!decision.allow) {
      diagnostics.filteredByHarmRiskHintCount += 1;
      continue;
    }

    scoredCandidates.push({
      suggestion,
      kind,
      utilityScore: utilityScoreForSuggestion(suggestion, kind),
      expectedHarmfulReductionScore: decision.expectedHarmfulReduction,
      contextualBanditScore: decision.contextualBanditScore,
      harmfulRateBaseline: decision.harmfulRateBaseline,
      harmfulRateForKind: decision.harmfulRateForKind,
    });
  }

  scoredCandidates.sort((left, right) => {
    if (right.contextualBanditScore !== left.contextualBanditScore) {
      return right.contextualBanditScore - left.contextualBanditScore;
    }

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
  policy: HintPolicyContext,
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

  const scoredCandidates = buildScoredCandidates(suggestions, diagnostics, policy);
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

async function queryHintPolicyEvents(loop: LearningLoop): Promise<TraceEvent[]> {
  const queryEvents = (
    loop as unknown as {
      queryEvents?: (query?: TraceQuery) => Promise<TraceEvent[]>;
    }
  ).queryEvents;

  if (typeof queryEvents !== "function") {
    return [];
  }

  try {
    return await queryEvents({
      types: ["checkpoint", "tool_result"],
      limit: 50_000,
    });
  } catch {
    return [];
  }
}

async function loadHintPolicyMemory(loop: LearningLoop): Promise<HintPolicyMemory> {
  const events = await queryHintPolicyEvents(loop);
  return buildHintPolicyMemory(events);
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
  const errorTimeHintMatcher = options.errorTimeHintMatcher ?? null;

  const sessionId = options.sessionId ?? randomUUID();
  const turnStartTimes = new Map<number, number>();
  const toolCalls = new Map<string, ToolCallState>();
  const errorTimeHintsFired = new Set<string>();
  let latestUserInputEventId: string | null = null;
  let hintPolicyMemoryPromise: Promise<HintPolicyMemory> | null = null;
  let errorTimeHintTotalCount = 0;

  async function getHintPolicyMemory(): Promise<HintPolicyMemory> {
    if (retrievalMemoryMode === "live") {
      return loadHintPolicyMemory(retrievalLoop);
    }

    if (!hintPolicyMemoryPromise) {
      hintPolicyMemoryPromise = loadHintPolicyMemory(retrievalLoop);
    }

    return hintPolicyMemoryPromise;
  }

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

    // Pending tool-call hints: flagged on tool_call, injected on tool_result.
    const pendingToolCallHints = new Map<string, ToolCallHint>();
    const toolCallHintsFired = new Set<string>();
    let toolCallHintTotalCount = 0;

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

      // Proactive hint: detect throwaway heredoc scripts (reinvention patterns).
      const cmd = commandFromInput(event.input);
      if (cmd && errorTimeHintMatcher) {
        const tcHint = matchToolCallReinvention(cmd);
        if (tcHint && !toolCallHintsFired.has(tcHint.hintId)) {
          pendingToolCallHints.set(event.toolCallId, tcHint);
        }
      }
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

      // Proactive tool-call hint: if this call was flagged as a reinvention, inject hint.
      const pendingTcHint = pendingToolCallHints.get(event.toolCallId);
      if (pendingTcHint && !isError) {
        pendingToolCallHints.delete(event.toolCallId);
        if (!toolCallHintsFired.has(pendingTcHint.hintId)) {
          toolCallHintsFired.add(pendingTcHint.hintId);
          toolCallHintTotalCount += 1;

          await ingest({
            type: "checkpoint",
            payload: {
              kind: "happy_paths_tool_call_hint",
              hintId: pendingTcHint.hintId,
              detectedPattern: pendingTcHint.detectedPattern,
              betterAlternative: pendingTcHint.betterAlternative,
              exampleCommand: pendingTcHint.exampleCommand,
              confidence: pendingTcHint.confidence,
              toolCallId: event.toolCallId,
              toolCallHintTotalCount,
            },
            tags: ["happy_paths", "tool_call_hint"],
          });

          const hintText = formatToolCallHint(pendingTcHint);
          const existingContent = event.content ?? [];
          return {
            content: [...existingContent, { type: "text" as const, text: hintText }],
          };
        }
      }
      pendingToolCallHints.delete(event.toolCallId);

      // Error-time hint interception: match error text → inject fix hint.
      if (!isError || !errorTimeHintMatcher || !text) {
        return undefined;
      }

      const hint = errorTimeHintMatcher.match(text);
      if (!hint) {
        return undefined;
      }

      // Dedup: don't fire the same hint ID more than once per session.
      if (errorTimeHintsFired.has(hint.hintId)) {
        return undefined;
      }
      errorTimeHintsFired.add(hint.hintId);
      errorTimeHintTotalCount += 1;

      // Log a checkpoint for analysis.
      await ingest({
        type: "checkpoint",
        payload: {
          kind: "happy_paths_error_time_hint",
          hintId: hint.hintId,
          hintFamily: hint.family,
          matchedPattern: hint.matchedPattern,
          matchedText: hint.matchedText.slice(0, 200),
          explanation: hint.explanation,
          fixCommand: hint.fixCommand,
          confidence: hint.confidence,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          command: call ? commandFromInput(call.input) : undefined,
          errorTimeHintTotalCount,
          sessionHintsFiredCount: errorTimeHintsFired.size,
        },
        tags: ["happy_paths", "error_time_hint"],
      });

      // Append the hint to the tool result content the LLM sees.
      const envFormat = process.env.HAPPY_PATHS_HINT_FORMAT;
      const hintFormat =
        envFormat === "terse"
          ? "terse"
          : envFormat === "adaptive"
            ? "adaptive"
            : "verbose";
      const hintText = formatErrorTimeHint(hint, hintFormat);
      const existingContent = event.content ?? [];
      return {
        content: [...existingContent, { type: "text" as const, text: hintText }],
      };
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

      // Allow disabling before_agent_start entirely (error-time-only mode).
      const beforeAgentStartDisabled =
        process.env.HAPPY_PATHS_BEFORE_AGENT_START === "false" ||
        process.env.HAPPY_PATHS_BEFORE_AGENT_START === "0";
      if (beforeAgentStartDisabled) {
        await ingest({
          type: "checkpoint",
          payload: {
            kind: "happy_paths_prior_hints",
            hintMode,
            hintCount: 0,
            beforeAgentStartDisabled: true,
          },
        });
        return undefined;
      }

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
            filteredByHarmRiskHintCount: 0,
            policySuppressedByBudgetCount: 0,
            policySuppressedByArtifactPriorityCount: 0,
            policySuppressedByCounterfactualCount: 0,
            selectedArtifactHintCount: 0,
            selectedFailureWarningHintCount: 0,
            selectedRetrievalHintCount: 0,
            selectedOtherHintCount: 0,
            selectedHintKind: null,
            selectedHintUtilityScore: null,
            selectedExpectedHarmfulReductionScore: null,
            selectedContextualBanditScore: null,
            selectedHarmfulRateBaseline: null,
            selectedHarmfulRateForKind: null,
            policyContextKey: null,
            policyMemorySessionCount: 0,
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

      const hintPolicyContext: HintPolicyContext = {
        contextKey: hintPolicyContextKeyFromSessionId(sessionId),
        memory: await getHintPolicyMemory(),
      };

      const selection =
        hintMode === "artifact_only"
          ? selectArtifactOnlySuggestions(
              nonSelfSuggestions,
              maxSuggestions,
              hintPolicyContext,
            )
          : selectTopSuggestionsWithPolicy(
              nonSelfSuggestions,
              maxSuggestions,
              hintPolicyContext,
            );
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
          filteredByHarmRiskHintCount:
            selection.diagnostics.filteredByHarmRiskHintCount,
          policySuppressedByBudgetCount:
            selection.diagnostics.policySuppressedByBudgetCount,
          policySuppressedByArtifactPriorityCount:
            selection.diagnostics.policySuppressedByArtifactPriorityCount,
          policySuppressedByCounterfactualCount:
            selection.diagnostics.policySuppressedByCounterfactualCount,
          selectedArtifactHintCount: selection.diagnostics.selectedArtifactHintCount,
          selectedFailureWarningHintCount:
            selection.diagnostics.selectedFailureWarningHintCount,
          selectedRetrievalHintCount: selection.diagnostics.selectedRetrievalHintCount,
          selectedOtherHintCount: selection.diagnostics.selectedOtherHintCount,
          selectedHintKind: selection.diagnostics.selectedHintKind,
          selectedHintUtilityScore: selection.diagnostics.selectedHintUtilityScore,
          selectedExpectedHarmfulReductionScore:
            selection.diagnostics.selectedExpectedHarmfulReductionScore,
          selectedContextualBanditScore:
            selection.diagnostics.selectedContextualBanditScore,
          selectedHarmfulRateBaseline:
            selection.diagnostics.selectedHarmfulRateBaseline,
          selectedHarmfulRateForKind: selection.diagnostics.selectedHarmfulRateForKind,
          policyContextKey: selection.diagnostics.policyContextKey,
          policyMemorySessionCount: selection.diagnostics.policyMemorySessionCount,
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
