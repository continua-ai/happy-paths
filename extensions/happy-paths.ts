import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  type PiLikeApi,
  type TraceScope,
  createLocalLearningLoop,
  createPiTraceExtension,
} from "../dist/index.js";

type PiExtensionContext = {
  ui?: {
    setStatus?: (key: string, status: string) => void;
  };
};

function setPiStatus(ctx: unknown, status: string): void {
  if (!ctx || typeof ctx !== "object") {
    return;
  }

  const ui = (ctx as PiExtensionContext).ui;
  if (ui?.setStatus) {
    ui.setStatus("happy-paths", status);
  }
}

function resolvedPathFromEnv(raw: string, fallbackPath: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallbackPath;
  }

  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }

  return resolve(process.cwd(), trimmed);
}

function traceRootFromEnv(): string {
  return resolvedPathFromEnv(
    process.env.HAPPY_PATHS_TRACE_ROOT ?? "",
    join(homedir(), ".happy-paths", "traces"),
  );
}

function retrievalTraceRootFromEnv(traceRoot: string): string {
  return resolvedPathFromEnv(
    process.env.HAPPY_PATHS_RETRIEVAL_TRACE_ROOT ?? "",
    traceRoot,
  );
}

function scopeFromEnv(): TraceScope {
  const raw = (process.env.HAPPY_PATHS_TRACE_SCOPE ?? "").trim().toLowerCase();
  if (raw === "team") {
    return "team";
  }
  if (raw === "public") {
    return "public";
  }
  return "personal";
}

function maxSuggestionsFromEnv(): number {
  const raw = (process.env.HAPPY_PATHS_MAX_SUGGESTIONS ?? "").trim();
  if (!raw) {
    return 3;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 3;
  }

  return Math.max(0, Math.floor(parsed));
}

function sessionIdFromEnv(): string | undefined {
  const raw = (process.env.HAPPY_PATHS_SESSION_ID ?? "").trim();
  if (!raw) {
    return undefined;
  }
  return raw;
}

function hintModeFromEnv(): "all" | "artifact_only" {
  const raw = (process.env.HAPPY_PATHS_HINT_MODE ?? "").trim().toLowerCase();
  if (raw === "artifact_only") {
    return "artifact_only";
  }
  return "all";
}

export default function happyPathsPiExtension(pi: PiLikeApi): void {
  const traceRoot = traceRootFromEnv();
  const retrievalTraceRoot = retrievalTraceRootFromEnv(traceRoot);
  const scope = scopeFromEnv();
  const maxSuggestions = maxSuggestionsFromEnv();
  const hintMode = hintModeFromEnv();
  const sessionId = sessionIdFromEnv();

  const ingestLoop = createLocalLearningLoop({ dataDir: traceRoot });
  const retrievalLoop =
    retrievalTraceRoot === traceRoot
      ? ingestLoop
      : createLocalLearningLoop({ dataDir: retrievalTraceRoot });
  const retrievalMemoryMode = retrievalTraceRoot === traceRoot ? "live" : "frozen";

  let bootstrapped = false;

  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    if (bootstrapped) {
      return;
    }

    try {
      const result = await retrievalLoop.bootstrapFromStore();
      bootstrapped = true;
      const retrievalRootSuffix =
        retrievalTraceRoot === traceRoot
          ? ""
          : ` · retrievalRoot=${retrievalTraceRoot}`;
      setPiStatus(
        ctx,
        `Happy Paths: ${result.eventCount} retrieval events (${scope}, ${retrievalMemoryMode}) · traceRoot=${traceRoot}${retrievalRootSuffix}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPiStatus(ctx, `Happy Paths bootstrap failed: ${message}`);
    }
  });

  createPiTraceExtension({
    loop: ingestLoop,
    retrievalLoop,
    scope,
    sessionId,
    maxSuggestions,
    hintMode,
  })(pi);
}
