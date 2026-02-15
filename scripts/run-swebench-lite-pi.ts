#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  type SweBenchLiteTask,
  type SweBenchLiteTaskPack,
  buildTaskPrompt,
} from "../src/benchmarks/swebenchLite.js";

type RunVariant = "off" | "on";
type TraceStateMode = "shared" | "isolated";

type PiRunRecord = {
  instanceId: string;
  repo: string;
  baseCommit: string;
  variant: RunVariant;
  replicate: number;
  sessionId: string;
  startedAtUtc: string;
  endedAtUtc: string;
  durationMs: number;
  exitCode: number;
  rawExitCode: number;
  timedOut: boolean;
  timeoutGuardNormalized: boolean;
  timeoutSecondsBudget: number;
  repoCheckoutPath: string;
  traceDataDir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  finalAnswerPath: string;
  command: string;
};

type PriorHintVisibilitySummary = {
  onRunCount: number;
  onRunsWithCheckpoint: number;
  onRunsWithHints: number;
  onRunsWithRetrievalHints: number;
  onRunsWithFailureWarningHints: number;
  onRunsWithArtifactHints: number;
  totalHintCount: number;
  totalRetrievalHintCount: number;
  totalFailureWarningHintCount: number;
  totalArtifactHintCount: number;
};

type Manifest = {
  schemaVersion: 1;
  generatedAtUtc: string;
  tasksPath: string;
  traceRoot: string;
  workspaceRoot: string;
  outputRoot: string;
  model: {
    provider: string | null;
    model: string | null;
    thinking: string | null;
  };
  selection: {
    offset: number;
    count: number;
    replicates: number;
    selectedInstanceIds: string[];
  };
  options: {
    sessionIdPrefix: string;
    onMaxSuggestions: number;
    timeoutSeconds: number;
    offTimeoutSeconds: number | null;
    onTimeoutSeconds: number | null;
    prepareRepo: boolean;
    traceStateMode: TraceStateMode;
    seedTraceRoot: string | null;
    cleanTraceRoot: boolean;
    pruneSeedTraceAfterRun: boolean;
  };
  qualityChecks: {
    modelPreflightPassed: boolean;
    timeoutGuardNormalizationCount: number;
    priorHintVisibility: PriorHintVisibilitySummary;
  };
  runs: PiRunRecord[];
};

function parseIntArg(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): {
  tasks: string;
  traceRoot: string;
  workspaceRoot: string;
  outDir: string;
  offset: number;
  count: number;
  replicates: number;
  sessionIdPrefix: string;
  onMaxSuggestions: number;
  timeoutSeconds: number;
  offTimeoutSeconds: number | null;
  onTimeoutSeconds: number | null;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  prepareRepo: boolean;
  traceStateMode: TraceStateMode;
  seedTraceRoot: string | null;
  cleanTraceRoot: boolean;
} {
  const options = {
    tasks: ".happy-paths/benchmarks/swebench_lite_50/tasks.json",
    traceRoot: ".happy-paths/benchmarks/swebench_lite_50/traces",
    workspaceRoot: ".happy-paths/benchmarks/swebench_lite_50/workspaces",
    outDir: ".happy-paths/benchmarks/swebench_lite_50/pi_runs",
    offset: 0,
    count: 3,
    replicates: 1,
    sessionIdPrefix: "swebench",
    onMaxSuggestions: 3,
    timeoutSeconds: 180,
    offTimeoutSeconds: null as number | null,
    onTimeoutSeconds: null as number | null,
    provider: null as string | null,
    model: null as string | null,
    thinking: null as string | null,
    prepareRepo: true,
    traceStateMode: "isolated" as TraceStateMode,
    seedTraceRoot: null as string | null,
    cleanTraceRoot: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--tasks") {
      options.tasks = String(value);
      index += 1;
      continue;
    }
    if (token === "--trace-root") {
      options.traceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--workspace-root") {
      options.workspaceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--out-dir") {
      options.outDir = String(value);
      index += 1;
      continue;
    }
    if (token === "--offset") {
      options.offset = Math.max(0, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--count") {
      options.count = Math.max(1, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--replicates") {
      options.replicates = Math.max(1, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--session-id-prefix") {
      options.sessionIdPrefix = String(value);
      index += 1;
      continue;
    }
    if (token === "--on-max-suggestions") {
      options.onMaxSuggestions = Math.max(0, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--timeout-seconds") {
      options.timeoutSeconds = Math.max(120, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--off-timeout-seconds") {
      options.offTimeoutSeconds = Math.max(120, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--on-timeout-seconds") {
      options.onTimeoutSeconds = Math.max(120, parseIntArg(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--provider") {
      options.provider = String(value);
      index += 1;
      continue;
    }
    if (token === "--model") {
      options.model = String(value);
      index += 1;
      continue;
    }
    if (token === "--thinking") {
      options.thinking = String(value);
      index += 1;
      continue;
    }
    if (token === "--trace-state-mode") {
      const mode = String(value);
      if (mode !== "shared" && mode !== "isolated") {
        throw new Error(`invalid --trace-state-mode: ${mode}`);
      }
      options.traceStateMode = mode;
      index += 1;
      continue;
    }
    if (token === "--seed-trace-root") {
      options.seedTraceRoot = String(value);
      index += 1;
      continue;
    }
    if (token === "--no-clean-trace-root") {
      options.cleanTraceRoot = false;
      continue;
    }
    if (token === "--no-prepare-repo") {
      options.prepareRepo = false;
    }
  }

  return options;
}

function runCommand(cwd: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `command failed (${result.status ?? "unknown"}): ${command} ${args.join(" ")}`,
    );
  }
}

function runCommandCaptured(options: {
  cwd: string;
  command: string;
  args: string[];
  timeoutSeconds: number;
  env?: NodeJS.ProcessEnv;
}): {
  rawExitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
} {
  const timeoutBin = process.env.HAPPY_PATHS_TIMEOUT_BIN ?? "timeout";
  const timeoutArgs = [
    "--signal=TERM",
    "--kill-after=5s",
    `${options.timeoutSeconds}s`,
    options.command,
    ...options.args,
  ];

  const wrapped = spawnSync(timeoutBin, timeoutArgs, {
    cwd: options.cwd,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    env: options.env ?? process.env,
  });

  if (!wrapped.error) {
    const rawExitCode = wrapped.status ?? 1;
    return {
      rawExitCode,
      timedOut: rawExitCode === 124,
      stdout: wrapped.stdout ?? "",
      stderr: wrapped.stderr ?? "",
    };
  }

  const fallback = spawnSync(options.command, options.args, {
    cwd: options.cwd,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeoutSeconds * 1000,
    env: options.env ?? process.env,
  });

  const timedOut = fallback.signal === "SIGTERM";
  const rawExitCode = timedOut ? 124 : (fallback.status ?? 1);

  return {
    rawExitCode,
    timedOut,
    stdout: fallback.stdout ?? "",
    stderr: fallback.stderr ?? "",
  };
}

type ModelCatalogRow = {
  provider: string;
  model: string;
};

type PriorHintSessionSummary = {
  hasCheckpoint: boolean;
  hintCount: number;
  retrievalHintCount: number;
  failureWarningHintCount: number;
  artifactHintCount: number;
};

function parseModelCatalogRows(raw: string): ModelCatalogRow[] {
  const rows: ModelCatalogRow[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("provider")) {
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 2) {
      continue;
    }

    rows.push({
      provider: tokens[0],
      model: tokens[1],
    });
  }

  return rows;
}

function ensureModelAvailableAndRunnable(options: {
  provider: string | null;
  model: string | null;
}): void {
  if (!options.provider || !options.model) {
    return;
  }

  const listing = spawnSync("pi", ["--list-models", options.model], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: process.env,
  });

  if (listing.status !== 0) {
    throw new Error(
      `model preflight failed while listing models for ${options.provider}/${options.model}: ${
        listing.stderr?.trim() || "pi --list-models failed"
      }`,
    );
  }

  const rows = parseModelCatalogRows(listing.stdout ?? "");
  const hasExact = rows.some(
    (row) => row.provider === options.provider && row.model === options.model,
  );

  if (!hasExact) {
    const related = rows
      .filter((row) => row.model === options.model)
      .map((row) => `${row.provider}/${row.model}`)
      .slice(0, 8);
    const relatedText = related.length > 0 ? related.join(", ") : "none";

    throw new Error(
      `requested model not listed: ${options.provider}/${options.model}. related matches: ${relatedText}`,
    );
  }

  const healthcheck = spawnSync(
    "pi",
    [
      "--provider",
      options.provider,
      "--model",
      options.model,
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--print",
      "Reply with OK only.",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
      timeout: 120 * 1000,
      env: process.env,
    },
  );

  if (healthcheck.status !== 0) {
    const stderr = (healthcheck.stderr ?? "").trim();
    const stdout = (healthcheck.stdout ?? "").trim();
    throw new Error(
      `model preflight failed for ${options.provider}/${options.model}: status=${healthcheck.status ?? "unknown"} stderr=${stderr || "<empty>"} stdout=${stdout || "<empty>"}`,
    );
  }
}

async function summarizePriorHintsFromSession(
  sessionPath: string,
): Promise<PriorHintSessionSummary> {
  const raw = await readFile(sessionPath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return {
      hasCheckpoint: false,
      hintCount: 0,
      retrievalHintCount: 0,
      failureWarningHintCount: 0,
      artifactHintCount: 0,
    };
  }

  let hasCheckpoint = false;
  let hintCount = 0;
  let retrievalHintCount = 0;
  let failureWarningHintCount = 0;
  let artifactHintCount = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      continue;
    }

    if (!event || typeof event !== "object") {
      continue;
    }

    const eventRecord = event as {
      type?: unknown;
      payload?: unknown;
    };
    if (eventRecord.type !== "checkpoint") {
      continue;
    }

    if (!eventRecord.payload || typeof eventRecord.payload !== "object") {
      continue;
    }

    const payload = eventRecord.payload as {
      kind?: unknown;
      hintCount?: unknown;
      retrievalHintCount?: unknown;
      failureWarningHintCount?: unknown;
      artifactHintCount?: unknown;
    };

    if (payload.kind !== "happy_paths_prior_hints") {
      continue;
    }

    hasCheckpoint = true;

    const parsedHintCount =
      typeof payload.hintCount === "number" ? payload.hintCount : 0;
    const parsedRetrievalHintCount =
      typeof payload.retrievalHintCount === "number" ? payload.retrievalHintCount : 0;
    const parsedFailureWarningHintCount =
      typeof payload.failureWarningHintCount === "number"
        ? payload.failureWarningHintCount
        : 0;
    const parsedArtifactHintCount =
      typeof payload.artifactHintCount === "number" ? payload.artifactHintCount : 0;

    hintCount = Math.max(hintCount, parsedHintCount);
    retrievalHintCount = Math.max(retrievalHintCount, parsedRetrievalHintCount);
    failureWarningHintCount = Math.max(
      failureWarningHintCount,
      parsedFailureWarningHintCount,
    );
    artifactHintCount = Math.max(artifactHintCount, parsedArtifactHintCount);
  }

  return {
    hasCheckpoint,
    hintCount,
    retrievalHintCount,
    failureWarningHintCount,
    artifactHintCount,
  };
}

function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseTaskPack(raw: string): SweBenchLiteTaskPack {
  const parsed = JSON.parse(raw) as Partial<SweBenchLiteTaskPack>;
  if (!Array.isArray(parsed.tasks)) {
    throw new Error("invalid task pack: missing tasks");
  }

  return {
    schemaVersion: 1,
    generatedAtUtc:
      typeof parsed.generatedAtUtc === "string"
        ? parsed.generatedAtUtc
        : new Date().toISOString(),
    source:
      parsed.source && typeof parsed.source === "object"
        ? {
            dataset:
              typeof parsed.source.dataset === "string"
                ? parsed.source.dataset
                : "unknown",
            config:
              typeof parsed.source.config === "string"
                ? parsed.source.config
                : "unknown",
            split:
              typeof parsed.source.split === "string" ? parsed.source.split : "unknown",
            offset: typeof parsed.source.offset === "number" ? parsed.source.offset : 0,
            count: typeof parsed.source.count === "number" ? parsed.source.count : 0,
            fetchedAtUtc:
              typeof parsed.source.fetchedAtUtc === "string"
                ? parsed.source.fetchedAtUtc
                : new Date().toISOString(),
            url: typeof parsed.source.url === "string" ? parsed.source.url : "",
          }
        : {
            dataset: "unknown",
            config: "unknown",
            split: "unknown",
            offset: 0,
            count: 0,
            fetchedAtUtc: new Date().toISOString(),
            url: "",
          },
    tasks: parsed.tasks as SweBenchLiteTask[],
  };
}

function buildPrompt(task: SweBenchLiteTask): string {
  const instructions = [
    "Execution instructions:",
    "- Work directly in this checked-out repository.",
    "- Investigate with shell commands and file reads.",
    "- Attempt a concrete fix and run at least one targeted validation command.",
    "- If blocked by environment/dependencies, report the blocker explicitly.",
    "- End your answer with:",
    "  FINAL_STATUS: success|partial|blocked",
    "  FINAL_NOTES: <single line>",
  ].join("\n");

  return `${buildTaskPrompt(task)}\n\n${instructions}`;
}

async function ensureRepoCheckout(options: {
  repoSlug: string;
  baseCommit: string;
  checkoutRoot: string;
}): Promise<string> {
  const repoDir = resolve(
    options.checkoutRoot,
    sanitizePathComponent(options.repoSlug),
    sanitizePathComponent(options.baseCommit),
  );

  const remoteUrl = `https://github.com/${options.repoSlug}.git`;
  await mkdir(dirname(repoDir), { recursive: true });

  if (!existsSync(join(repoDir, ".git"))) {
    runCommand(process.cwd(), "git", ["clone", "--no-checkout", remoteUrl, repoDir]);
  }

  runCommand(repoDir, "git", ["fetch", "--depth", "1", "origin", options.baseCommit]);
  runCommand(repoDir, "git", ["checkout", "--force", options.baseCommit]);
  runCommand(repoDir, "git", ["reset", "--hard", options.baseCommit]);
  runCommand(repoDir, "git", ["clean", "-fd"]);

  return repoDir;
}

function resetRepoCheckout(repoDir: string, baseCommit: string): void {
  if (!existsSync(join(repoDir, ".git"))) {
    return;
  }

  const indexLockPath = join(repoDir, ".git", "index.lock");
  if (existsSync(indexLockPath)) {
    rmSync(indexLockPath, { force: true });
  }

  runCommand(repoDir, "git", ["checkout", "--force", baseCommit]);
  runCommand(repoDir, "git", ["reset", "--hard", baseCommit]);
  runCommand(repoDir, "git", ["clean", "-fd"]);
}

async function copyDirectoryContents(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  if (!existsSync(sourceDir)) {
    return;
  }

  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    await cp(sourcePath, targetPath, { recursive: true });
  }
}

async function primeSharedTraceRoot(options: {
  traceRoot: string;
  seedTraceRoot: string | null;
}): Promise<void> {
  if (!options.seedTraceRoot) {
    return;
  }

  await copyDirectoryContents(options.seedTraceRoot, options.traceRoot);
}

async function prepareTraceDataDir(options: {
  traceRoot: string;
  traceStateMode: TraceStateMode;
  seedTraceRoot: string | null;
  instanceId: string;
  replicate: number;
  variant: RunVariant;
}): Promise<string> {
  if (options.traceStateMode === "shared") {
    return options.traceRoot;
  }

  const isolatedRoot = resolve(
    options.traceRoot,
    "isolated",
    sanitizePathComponent(options.instanceId),
    `r${options.replicate}`,
  );

  if (options.seedTraceRoot) {
    const variantTraceDir = resolve(isolatedRoot, options.variant);
    await rm(variantTraceDir, { recursive: true, force: true });
    await mkdir(variantTraceDir, { recursive: true });
    await copyDirectoryContents(options.seedTraceRoot, variantTraceDir);
    return variantTraceDir;
  }

  if (options.variant === "off") {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
  await mkdir(isolatedRoot, { recursive: true });

  return isolatedRoot;
}

async function pruneTraceDataDirToSession(
  traceDataDir: string,
  sessionId: string,
): Promise<void> {
  const sessionPath = join(traceDataDir, "sessions", `${sessionId}.jsonl`);
  const sessionContent = await readFile(sessionPath, "utf-8").catch(() => "");

  await rm(traceDataDir, { recursive: true, force: true });
  await mkdir(dirname(sessionPath), { recursive: true });

  if (!sessionContent.trim()) {
    return;
  }

  await writeFile(sessionPath, sessionContent, "utf-8");
}

function buildPiArgs(options: {
  extensionPath: string;
  promptPath: string;
  provider: string | null;
  model: string | null;
  thinking: string | null;
}): string[] {
  const args = [
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "-e",
    options.extensionPath,
  ];

  if (options.provider) {
    args.push("--provider", options.provider);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.thinking) {
    args.push("--thinking", options.thinking);
  }

  args.push(`@${options.promptPath}`);

  return args;
}

async function runVariant(options: {
  task: SweBenchLiteTask;
  variant: RunVariant;
  replicate: number;
  sessionIdPrefix: string;
  onMaxSuggestions: number;
  traceDataDir: string;
  extensionPath: string;
  repoCheckoutPath: string;
  logsDir: string;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  timeoutSeconds: number;
  pruneTraceDataDirToSession: boolean;
}): Promise<PiRunRecord> {
  const slug = `${sanitizePathComponent(options.task.instanceId)}-${options.variant}-r${options.replicate}`;
  const sessionId = `${options.sessionIdPrefix}::${options.task.instanceId}::${options.variant}::r${options.replicate}`;

  const promptPath = resolve(options.logsDir, `${slug}.prompt.md`);
  const stdoutPath = resolve(options.logsDir, `${slug}.stdout.log`);
  const stderrPath = resolve(options.logsDir, `${slug}.stderr.log`);
  const finalAnswerPath = resolve(options.logsDir, `${slug}.final.md`);

  const sessionPath = resolve(options.traceDataDir, "sessions", `${sessionId}.jsonl`);
  await rm(sessionPath, { force: true });

  const prompt = buildPrompt(options.task);
  await writeFile(promptPath, `${prompt}\n`, "utf-8");

  const env = {
    ...process.env,
    HAPPY_PATHS_TRACE_ROOT: options.traceDataDir,
    HAPPY_PATHS_TRACE_SCOPE: "public",
    HAPPY_PATHS_MAX_SUGGESTIONS:
      options.variant === "off" ? "0" : String(options.onMaxSuggestions),
    HAPPY_PATHS_SESSION_ID: sessionId,
    HAPPY_PATHS_BENCHMARK_SUITE: "swebench_lite",
    HAPPY_PATHS_SWEBENCH_INSTANCE_ID: options.task.instanceId,
    HAPPY_PATHS_SWEBENCH_REPO: options.task.repo,
    HAPPY_PATHS_SWEBENCH_VARIANT: options.variant,
    HAPPY_PATHS_SWEBENCH_REPLICATE: `r${options.replicate}`,
  };

  const args = buildPiArgs({
    extensionPath: options.extensionPath,
    promptPath,
    provider: options.provider,
    model: options.model,
    thinking: options.thinking,
  });

  const startedAt = new Date();
  const run = runCommandCaptured({
    cwd: options.repoCheckoutPath,
    command: "pi",
    args,
    timeoutSeconds: options.timeoutSeconds,
    env,
  });
  const endedAt = new Date();
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const timeoutBudgetMs = options.timeoutSeconds * 1000;
  const timeoutGuardNormalized = !run.timedOut && durationMs > timeoutBudgetMs + 5_000;
  const timedOut = run.timedOut || timeoutGuardNormalized;
  const exitCode = timedOut ? 124 : run.rawExitCode;

  let stderrOutput = run.stderr;
  if (timeoutGuardNormalized) {
    const timeoutGuardNote = `[timeout-guard] normalized timeout after overrun: durationMs=${durationMs}, timeoutBudgetMs=${timeoutBudgetMs}, rawExitCode=${run.rawExitCode}`;
    stderrOutput = `${stderrOutput}${stderrOutput ? "\n" : ""}${timeoutGuardNote}\n`;
  }

  await writeFile(stdoutPath, run.stdout, "utf-8");
  await writeFile(stderrPath, stderrOutput, "utf-8");
  await writeFile(finalAnswerPath, run.stdout, "utf-8");

  if (options.pruneTraceDataDirToSession) {
    await pruneTraceDataDirToSession(options.traceDataDir, sessionId);
  }

  return {
    instanceId: options.task.instanceId,
    repo: options.task.repo,
    baseCommit: options.task.baseCommit,
    variant: options.variant,
    replicate: options.replicate,
    sessionId,
    startedAtUtc: startedAt.toISOString(),
    endedAtUtc: endedAt.toISOString(),
    durationMs,
    exitCode,
    rawExitCode: run.rawExitCode,
    timedOut,
    timeoutGuardNormalized,
    timeoutSecondsBudget: options.timeoutSeconds,
    repoCheckoutPath: options.repoCheckoutPath,
    traceDataDir: options.traceDataDir,
    promptPath,
    stdoutPath,
    stderrPath,
    finalAnswerPath,
    command: `pi ${args.join(" ")}`,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const tasksPath = resolve(repoRoot, options.tasks);
  const traceRoot = resolve(repoRoot, options.traceRoot);
  const seedTraceRoot = options.seedTraceRoot
    ? resolve(repoRoot, options.seedTraceRoot)
    : null;
  const workspaceRoot = resolve(repoRoot, options.workspaceRoot);
  const outDir = resolve(repoRoot, options.outDir);
  const logsDir = resolve(outDir, "logs");
  const manifestPath = resolve(outDir, "manifest.json");
  const extensionPath = resolve(repoRoot, "extensions/happy-paths.ts");

  if (!existsSync(extensionPath)) {
    throw new Error(`extension not found: ${extensionPath}`);
  }

  if (seedTraceRoot && !existsSync(seedTraceRoot)) {
    throw new Error(`seed trace root not found: ${seedTraceRoot}`);
  }

  ensureModelAvailableAndRunnable({
    provider: options.provider,
    model: options.model,
  });

  const taskPack = parseTaskPack(await readFile(tasksPath, "utf-8"));
  const selectedTasks = taskPack.tasks.slice(
    options.offset,
    options.offset + options.count,
  );

  if (selectedTasks.length === 0) {
    throw new Error(
      `no tasks selected (offset=${options.offset}, count=${options.count}, total=${taskPack.tasks.length})`,
    );
  }

  if (options.cleanTraceRoot) {
    await rm(traceRoot, { recursive: true, force: true });
  }
  await mkdir(traceRoot, { recursive: true });

  if (options.traceStateMode === "shared") {
    await primeSharedTraceRoot({
      traceRoot,
      seedTraceRoot,
    });
  }

  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  runCommand(repoRoot, "npm", ["run", "build"]);

  const runs: PiRunRecord[] = [];

  for (const task of selectedTasks) {
    let repoCheckoutPath = repoRoot;

    if (options.prepareRepo) {
      repoCheckoutPath = await ensureRepoCheckout({
        repoSlug: task.repo,
        baseCommit: task.baseCommit,
        checkoutRoot: workspaceRoot,
      });
    }

    for (let replicate = 1; replicate <= options.replicates; replicate += 1) {
      for (const variant of ["off", "on"] as const) {
        if (options.prepareRepo) {
          resetRepoCheckout(repoCheckoutPath, task.baseCommit);
        }

        const traceDataDir = await prepareTraceDataDir({
          traceRoot,
          traceStateMode: options.traceStateMode,
          seedTraceRoot,
          instanceId: task.instanceId,
          replicate,
          variant,
        });

        const timeoutSecondsForVariant =
          variant === "off"
            ? (options.offTimeoutSeconds ?? options.timeoutSeconds)
            : (options.onTimeoutSeconds ?? options.timeoutSeconds);

        console.log(
          `[swebench-pi] running ${task.instanceId} ${variant} r${replicate} (repo=${task.repo}, traceDataDir=${traceDataDir}, timeoutSec=${timeoutSecondsForVariant})`,
        );

        const record = await runVariant({
          task,
          variant,
          replicate,
          sessionIdPrefix: options.sessionIdPrefix,
          onMaxSuggestions: options.onMaxSuggestions,
          traceDataDir,
          extensionPath,
          repoCheckoutPath,
          logsDir,
          provider: options.provider,
          model: options.model,
          thinking: options.thinking,
          timeoutSeconds: timeoutSecondsForVariant,
          pruneTraceDataDirToSession:
            options.traceStateMode === "isolated" && seedTraceRoot !== null,
        });

        runs.push(record);

        console.log(
          `[swebench-pi] done ${task.instanceId} ${variant} r${replicate} exit=${record.exitCode} rawExit=${record.rawExitCode} timeout=${record.timedOut} timeoutNormalized=${record.timeoutGuardNormalized} timeoutBudgetSec=${record.timeoutSecondsBudget} durationMs=${record.durationMs}`,
        );
      }
    }
  }

  const onRuns = runs.filter((run) => run.variant === "on");
  let onRunsWithCheckpoint = 0;
  let onRunsWithHints = 0;
  let onRunsWithRetrievalHints = 0;
  let onRunsWithFailureWarningHints = 0;
  let onRunsWithArtifactHints = 0;
  let totalHintCount = 0;
  let totalRetrievalHintCount = 0;
  let totalFailureWarningHintCount = 0;
  let totalArtifactHintCount = 0;

  for (const run of onRuns) {
    const sessionPath = resolve(run.traceDataDir, "sessions", `${run.sessionId}.jsonl`);
    const summary = await summarizePriorHintsFromSession(sessionPath);

    if (summary.hasCheckpoint) {
      onRunsWithCheckpoint += 1;
    }
    if (summary.hintCount > 0) {
      onRunsWithHints += 1;
    }
    if (summary.retrievalHintCount > 0) {
      onRunsWithRetrievalHints += 1;
    }
    if (summary.failureWarningHintCount > 0) {
      onRunsWithFailureWarningHints += 1;
    }
    if (summary.artifactHintCount > 0) {
      onRunsWithArtifactHints += 1;
    }

    totalHintCount += summary.hintCount;
    totalRetrievalHintCount += summary.retrievalHintCount;
    totalFailureWarningHintCount += summary.failureWarningHintCount;
    totalArtifactHintCount += summary.artifactHintCount;
  }

  const priorHintVisibility: PriorHintVisibilitySummary = {
    onRunCount: onRuns.length,
    onRunsWithCheckpoint,
    onRunsWithHints,
    onRunsWithRetrievalHints,
    onRunsWithFailureWarningHints,
    onRunsWithArtifactHints,
    totalHintCount,
    totalRetrievalHintCount,
    totalFailureWarningHintCount,
    totalArtifactHintCount,
  };

  const timeoutGuardNormalizationCount = runs.filter(
    (run) => run.timeoutGuardNormalized,
  ).length;

  if (onRuns.length > 0 && options.onMaxSuggestions > 0 && onRunsWithHints === 0) {
    console.warn(
      `[swebench-pi] WARN: ON hint visibility is zero (${onRunsWithHints}/${onRuns.length}). Consider --trace-state-mode shared or seeded traces for ON retrieval visibility.`,
    );
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    tasksPath,
    traceRoot,
    workspaceRoot,
    outputRoot: outDir,
    model: {
      provider: options.provider,
      model: options.model,
      thinking: options.thinking,
    },
    selection: {
      offset: options.offset,
      count: options.count,
      replicates: options.replicates,
      selectedInstanceIds: selectedTasks.map((task) => task.instanceId),
    },
    options: {
      sessionIdPrefix: options.sessionIdPrefix,
      onMaxSuggestions: options.onMaxSuggestions,
      timeoutSeconds: options.timeoutSeconds,
      offTimeoutSeconds: options.offTimeoutSeconds,
      onTimeoutSeconds: options.onTimeoutSeconds,
      prepareRepo: options.prepareRepo,
      traceStateMode: options.traceStateMode,
      seedTraceRoot,
      cleanTraceRoot: options.cleanTraceRoot,
      pruneSeedTraceAfterRun:
        options.traceStateMode === "isolated" && seedTraceRoot !== null,
    },
    qualityChecks: {
      modelPreflightPassed: true,
      timeoutGuardNormalizationCount,
      priorHintVisibility,
    },
    runs,
  };

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  console.log(
    JSON.stringify(
      {
        manifest: manifestPath,
        traceRoot,
        selectedTasks: manifest.selection.selectedInstanceIds,
        runCount: runs.length,
        qualityChecks: manifest.qualityChecks,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
