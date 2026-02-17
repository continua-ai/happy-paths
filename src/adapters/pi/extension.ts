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

export interface PiTraceExtensionOptions {
  loop: LearningLoop;
  scope?: TraceScope;
  harnessName?: string;
  agentId?: string;
  sessionId?: string;
  maxSuggestions?: number;
  suggestionQueryMaxChars?: number;
  suggestionPlanTimeoutMs?: number;
  suggestionTotalTimeoutMs?: number;
  customMessageType?: string;
  projectIdentity?: ProjectIdentityOverrides;
}

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_SUGGESTION_QUERY_MAX_CHARS = 4_000;
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

function selectTopSuggestions(
  suggestions: LearningSuggestion[],
  maxSuggestions: number,
): LearningSuggestion[] {
  if (maxSuggestions <= 0 || suggestions.length === 0) {
    return [];
  }

  const ranked = rankSuggestionsByConfidence(suggestions);
  const top = ranked.slice(0, maxSuggestions);

  if (top.some((suggestion) => suggestion.title === "Prior failure warning")) {
    return top;
  }

  const bestFailureWarning = ranked.find((suggestion) => {
    return suggestion.title === "Prior failure warning";
  });

  if (!bestFailureWarning) {
    return top;
  }

  const withFailureWarning = [
    ...top.slice(0, Math.max(0, top.length - 1)),
    bestFailureWarning,
  ];

  const deduped: LearningSuggestion[] = [];
  const seenIds = new Set<string>();
  for (const suggestion of withFailureWarning) {
    if (seenIds.has(suggestion.id)) {
      continue;
    }
    seenIds.add(suggestion.id);
    deduped.push(suggestion);
  }

  return deduped.slice(0, maxSuggestions);
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
  const scope = options.scope ?? "personal";
  const harness = options.harnessName ?? "pi";
  const agentId = options.agentId;
  const maxSuggestions = options.maxSuggestions ?? 3;
  const suggestionQueryMaxChars = Math.max(
    512,
    Math.floor(
      options.suggestionQueryMaxChars ?? DEFAULT_SUGGESTION_QUERY_MAX_CHARS,
    ),
  );
  const suggestionPlanTimeoutMs = Math.max(
    50,
    Math.floor(
      options.suggestionPlanTimeoutMs ?? DEFAULT_SUGGESTION_PLAN_TIMEOUT_MS,
    ),
  );
  const suggestionTotalTimeoutMs = Math.max(
    suggestionPlanTimeoutMs,
    Math.floor(
      options.suggestionTotalTimeoutMs ?? DEFAULT_SUGGESTION_TOTAL_TIMEOUT_MS,
    ),
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
            retrievalScope: "disabled",
            retrievalOutcomeFilter: "disabled",
            fallbackToGlobalToolResults: false,
            hintCount: 0,
            retrievalHintCount: 0,
            failureWarningHintCount: 0,
            artifactHintCount: 0,
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
      let suggestions = [] as Awaited<ReturnType<typeof loop.suggest>>;
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

        const candidate = await runWithTimeout(
          () => {
            return loop.suggest({
              text: suggestionQuery.text,
              limit: maxSuggestions + 2,
              filters: plan.filters,
            });
          },
          planTimeoutMs,
        );

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

      const topSuggestions = selectTopSuggestions(nonSelfSuggestions, maxSuggestions);
      const retrievalHintCount = topSuggestions.filter((suggestion) => {
        return suggestion.id.startsWith("retrieval-");
      }).length;
      const failureWarningHintCount = topSuggestions.filter((suggestion) => {
        return suggestion.title === "Prior failure warning";
      }).length;
      const artifactHintCount = topSuggestions.filter((suggestion) => {
        return suggestion.id.startsWith("artifact-");
      }).length;
      const availableFailureWarningHintCount = nonSelfSuggestions.filter(
        (suggestion) => {
          return suggestion.title === "Prior failure warning";
        },
      ).length;

      await ingest({
        type: "checkpoint",
        payload: {
          kind: "happy_paths_prior_hints",
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
          availableFailureWarningHintCount,
          artifactHintCount,
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
