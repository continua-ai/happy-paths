#!/usr/bin/env node

/**
 * Run the recurring-pattern benchmark with Pi.
 *
 * For each task, runs Pi in OFF (no hints) and ON (hints enabled) variants.
 * Repos are local (created by build-recurring-pattern-benchmark.ts).
 *
 * Usage:
 *   tsx scripts/run-recurring-pattern-pi.ts \
 *     --benchmark /tmp/rp-benchmark/benchmark.json \
 *     --out-dir /tmp/rp-results \
 *     --provider openai-codex --model gpt-5.3-codex \
 *     --replicates 2 --timeout-seconds 180
 */

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  RecurringPatternBenchmarkPack,
  RecurringPatternTask,
} from "../src/benchmarks/recurringPattern.js";
import { buildRecurringPatternPrompt } from "../src/benchmarks/recurringPattern.js";

type RunVariant = "off" | "on";
type HintMode = "full" | "artifact_only" | "none";
type TraceStateMode = "shared" | "isolated";

interface RunRecord {
  taskId: string;
  repoTemplateId: string;
  variant: RunVariant;
  replicate: number;
  sessionId: string;
  startedAtUtc: string;
  endedAtUtc: string;
  durationMs: number;
  exitCode: number;
  rawExitCode: number;
  timedOut: boolean;
  timeoutSecondsBudget: number;
  repoDir: string;
  traceDataDir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  expectedTrapIds: string[];
}

interface RPManifest {
  schemaVersion: 1;
  generatedAtUtc: string;
  benchmarkPath: string;
  traceRoot: string;
  outputRoot: string;
  model: {
    provider: string | null;
    model: string | null;
    thinking: string | null;
  };
  selection: {
    taskIds: string[];
    replicates: number;
  };
  options: {
    onMaxSuggestions: number;
    onHintMode: HintMode | null;
    timeoutSeconds: number;
    traceStateMode: TraceStateMode;
  };
  runs: RunRecord[];
}

function parseIntArg(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): {
  benchmark: string;
  outDir: string;
  traceRoot: string;
  replicates: number;
  onMaxSuggestions: number;
  onHintMode: HintMode | null;
  timeoutSeconds: number;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  traceStateMode: TraceStateMode;
  taskFilter: string | null;
  cleanTraceRoot: boolean;
} {
  const options = {
    benchmark: ".happy-paths/benchmarks/recurring-pattern/benchmark.json",
    outDir: "",
    traceRoot: "",
    replicates: 1,
    onMaxSuggestions: 3,
    onHintMode: null as HintMode | null,
    timeoutSeconds: 180,
    provider: null as string | null,
    model: null as string | null,
    thinking: null as string | null,
    traceStateMode: "shared" as TraceStateMode,
    taskFilter: null as string | null,
    cleanTraceRoot: true,
    noBeforeAgentStart: false,
    hintFormat: null as string | null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];

    if (token === "--benchmark" && value) {
      options.benchmark = value;
      i += 1;
      continue;
    }
    if (token === "--out-dir" && value) {
      options.outDir = value;
      i += 1;
      continue;
    }
    if (token === "--trace-root" && value) {
      options.traceRoot = value;
      i += 1;
      continue;
    }
    if (token === "--replicates" && value) {
      options.replicates = Math.max(1, parseIntArg(value, token));
      i += 1;
      continue;
    }
    if (token === "--on-max-suggestions" && value) {
      options.onMaxSuggestions = Math.max(0, parseIntArg(value, token));
      i += 1;
      continue;
    }
    if (token === "--on-hint-mode" && value) {
      if (value !== "full" && value !== "artifact_only" && value !== "none") {
        throw new Error(`invalid --on-hint-mode: ${value}`);
      }
      options.onHintMode = value;
      i += 1;
      continue;
    }
    if (token === "--timeout-seconds" && value) {
      options.timeoutSeconds = Math.max(30, parseIntArg(value, token));
      i += 1;
      continue;
    }
    if (token === "--provider" && value) {
      options.provider = value;
      i += 1;
      continue;
    }
    if (token === "--model" && value) {
      options.model = value;
      i += 1;
      continue;
    }
    if (token === "--thinking" && value) {
      options.thinking = value;
      i += 1;
      continue;
    }
    if (token === "--trace-state-mode" && value) {
      if (value !== "shared" && value !== "isolated") {
        throw new Error(`invalid --trace-state-mode: ${value}`);
      }
      options.traceStateMode = value;
      i += 1;
      continue;
    }
    if (token === "--task-filter" && value) {
      options.taskFilter = value;
      i += 1;
      continue;
    }
    if (token === "--no-clean-trace-root") {
      options.cleanTraceRoot = false;
    }
    if (token === "--no-before-agent-start") {
      options.noBeforeAgentStart = true;
    }
    if (token === "--hint-format" && value) {
      options.hintFormat = value;
      i += 1;
    }
  }

  // Default outDir and traceRoot based on timestamp.
  if (!options.outDir) {
    const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    options.outDir = `/tmp/rp_results_${ts}`;
  }
  if (!options.traceRoot) {
    options.traceRoot = join(options.outDir, "traces");
  }

  return options;
}

function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_");
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
  // Try GNU timeout first (for better signal handling).
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

  // Fallback: use Node's built-in timeout.
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

function resetRepo(repoDir: string): void {
  if (!existsSync(join(repoDir, ".git"))) {
    return;
  }
  const lockPath = join(repoDir, ".git", "index.lock");
  if (existsSync(lockPath)) {
    rmSync(lockPath, { force: true });
  }
  spawnSync("git", ["checkout", "--force", "."], { cwd: repoDir, stdio: "pipe" });
  // -fdx: also remove ignored files (.venv, .fixtures, .testdata, __pycache__, etc.)
  spawnSync("git", ["clean", "-fdx"], { cwd: repoDir, stdio: "pipe" });
}

async function prepareTraceDataDir(options: {
  traceRoot: string;
  traceStateMode: TraceStateMode;
  taskId: string;
  replicate: number;
  variant: RunVariant;
}): Promise<string> {
  if (options.traceStateMode === "shared") {
    return options.traceRoot;
  }

  const isolatedRoot = resolve(
    options.traceRoot,
    "isolated",
    sanitizePathComponent(options.taskId),
    `r${options.replicate}`,
  );

  if (options.variant === "off") {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
  await mkdir(isolatedRoot, { recursive: true });
  return isolatedRoot;
}

async function runVariant(options: {
  task: RecurringPatternTask;
  variant: RunVariant;
  replicate: number;
  onMaxSuggestions: number;
  onHintMode: HintMode | null;
  traceDataDir: string;
  extensionPath: string;
  repoDir: string;
  logsDir: string;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  timeoutSeconds: number;
  noBeforeAgentStart: boolean;
  hintFormat: string | null;
}): Promise<RunRecord> {
  const slug = `${sanitizePathComponent(options.task.taskId)}-${options.variant}-r${options.replicate}`;
  const sessionId = `rp::${options.task.taskId}::${options.variant}::r${options.replicate}`;

  const promptPath = resolve(options.logsDir, `${slug}.prompt.md`);
  const stdoutPath = resolve(options.logsDir, `${slug}.stdout.log`);
  const stderrPath = resolve(options.logsDir, `${slug}.stderr.log`);

  // Remove any existing session file.
  const sessionPath = resolve(options.traceDataDir, "sessions", `${sessionId}.jsonl`);
  await rm(sessionPath, { force: true });

  // Write the prompt.
  const prompt = buildRecurringPatternPrompt(options.task);
  await writeFile(promptPath, `${prompt}\n`, "utf-8");

  // Build environment.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HAPPY_PATHS_TRACE_ROOT: options.traceDataDir,
    HAPPY_PATHS_TRACE_SCOPE: "public",
    HAPPY_PATHS_MAX_SUGGESTIONS:
      options.variant === "off" ? "0" : String(options.onMaxSuggestions),
    HAPPY_PATHS_SESSION_ID: sessionId,
    HAPPY_PATHS_BENCHMARK_SUITE: "recurring_pattern",
  };

  if (options.variant === "off") {
    env.HAPPY_PATHS_HINT_MODE = "none";
    env.HAPPY_PATHS_ERROR_TIME_HINTS = "off";
  } else if (options.onHintMode !== null) {
    env.HAPPY_PATHS_HINT_MODE = options.onHintMode;
  }

  // Support disabling before_agent_start in ON variant (error-time-only mode).
  if (options.noBeforeAgentStart && options.variant === "on") {
    env.HAPPY_PATHS_BEFORE_AGENT_START = "false";
  }

  // Support terse hint format.
  if (options.hintFormat && options.variant === "on") {
    env.HAPPY_PATHS_HINT_FORMAT = options.hintFormat;
  }

  // Build pi args.
  const piArgs = [
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "-e",
    options.extensionPath,
  ];

  // Use "provider/model" format to lock the model and prevent Pi from
  // falling back to a different provider (e.g. haiku) on rate limits.
  if (options.provider && options.model) {
    const modelSpec = options.thinking
      ? `${options.provider}/${options.model}:${options.thinking}`
      : `${options.provider}/${options.model}`;
    piArgs.push("--model", modelSpec);
  } else {
    if (options.provider) {
      piArgs.push("--provider", options.provider);
    }
    if (options.model) {
      piArgs.push("--model", options.model);
    }
    if (options.thinking) {
      piArgs.push("--thinking", options.thinking);
    }
  }

  piArgs.push(`@${promptPath}`);

  // Run.
  const startedAt = new Date();
  const run = runCommandCaptured({
    cwd: options.repoDir,
    command: "pi",
    args: piArgs,
    timeoutSeconds: options.timeoutSeconds,
    env,
  });
  const endedAt = new Date();
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const timedOut = run.timedOut;
  const exitCode = timedOut ? 124 : run.rawExitCode;

  await writeFile(stdoutPath, run.stdout, "utf-8");
  await writeFile(stderrPath, run.stderr, "utf-8");

  return {
    taskId: options.task.taskId,
    repoTemplateId: options.task.repoTemplateId,
    variant: options.variant,
    replicate: options.replicate,
    sessionId,
    startedAtUtc: startedAt.toISOString(),
    endedAtUtc: endedAt.toISOString(),
    durationMs,
    exitCode,
    rawExitCode: run.rawExitCode,
    timedOut,
    timeoutSecondsBudget: options.timeoutSeconds,
    repoDir: options.repoDir,
    traceDataDir: options.traceDataDir,
    promptPath,
    stdoutPath,
    stderrPath,
    expectedTrapIds: options.task.expectedTrapIds,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const benchmarkPath = resolve(args.benchmark);
  const outDir = resolve(args.outDir);
  const traceRoot = resolve(args.traceRoot);
  const logsDir = resolve(outDir, "logs");
  const manifestPath = resolve(outDir, "manifest.json");
  const extensionPath = resolve(repoRoot, "extensions/happy-paths.ts");

  if (!existsSync(extensionPath)) {
    throw new Error(`extension not found: ${extensionPath}`);
  }
  if (!existsSync(benchmarkPath)) {
    throw new Error(`benchmark pack not found: ${benchmarkPath}`);
  }

  console.log("═══ Recurring-pattern benchmark runner ═══");
  console.log(`Benchmark: ${benchmarkPath}`);
  console.log(`Output: ${outDir}`);
  console.log(`Trace root: ${traceRoot}`);
  console.log(`Trace state mode: ${args.traceStateMode}`);
  console.log(`Provider: ${args.provider ?? "(default)"}`);
  console.log(`Model: ${args.model ?? "(default)"}`);
  console.log(`Timeout: ${args.timeoutSeconds}s`);
  console.log(`Replicates: ${args.replicates}`);
  console.log();

  // Load benchmark pack.
  const raw = await readFile(benchmarkPath, "utf-8");
  const pack = JSON.parse(raw) as RecurringPatternBenchmarkPack;

  // Resolve repo directories (sibling to benchmark.json).
  const benchmarkDir = dirname(benchmarkPath);
  const repoDirs: Record<string, string> = {};
  for (const template of pack.templates) {
    const repoDir = resolve(benchmarkDir, "repos", template.templateId);
    if (!existsSync(repoDir)) {
      throw new Error(`repo dir not found: ${repoDir}`);
    }
    repoDirs[template.templateId] = repoDir;
  }

  // Filter tasks.
  let tasks = pack.tasks;
  if (args.taskFilter) {
    const pattern = new RegExp(args.taskFilter);
    tasks = tasks.filter(
      (t) => pattern.test(t.taskId) || pattern.test(t.repoTemplateId),
    );
  }

  if (tasks.length === 0) {
    throw new Error("no tasks match filter");
  }

  console.log(`Tasks: ${tasks.length} (of ${pack.tasks.length} total)`);
  for (const task of tasks) {
    console.log(
      `  ${task.taskId} [${task.repoTemplateId}] traps: ${task.expectedTrapIds.join(", ")}`,
    );
  }
  console.log();

  // Create directories.
  if (args.cleanTraceRoot) {
    await rm(traceRoot, { recursive: true, force: true });
  }
  await mkdir(traceRoot, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  // Build the extension.
  console.log("Building extension...");
  spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
  console.log();

  // Run tasks.
  const runs: RunRecord[] = [];
  const totalRuns = tasks.length * args.replicates * 2; // off + on
  let runIndex = 0;

  for (const task of tasks) {
    const repoDir = repoDirs[task.repoTemplateId];
    if (!repoDir) {
      throw new Error(`no repo dir for template: ${task.repoTemplateId}`);
    }

    for (let replicate = 1; replicate <= args.replicates; replicate += 1) {
      for (const variant of ["off", "on"] as const) {
        runIndex += 1;

        // Reset repo to clean state.
        resetRepo(repoDir);

        const traceDataDir = await prepareTraceDataDir({
          traceRoot,
          traceStateMode: args.traceStateMode,
          taskId: task.taskId,
          replicate,
          variant,
        });

        console.log(
          `[rp-pi] (${runIndex}/${totalRuns}) ${task.taskId} ${variant} r${replicate} timeout=${args.timeoutSeconds}s`,
        );

        const record = await runVariant({
          task,
          variant,
          replicate,
          onMaxSuggestions: args.onMaxSuggestions,
          onHintMode: args.onHintMode,
          traceDataDir,
          extensionPath,
          repoDir,
          logsDir,
          provider: args.provider,
          model: args.model,
          thinking: args.thinking,
          timeoutSeconds: args.timeoutSeconds,
          noBeforeAgentStart: args.noBeforeAgentStart,
          hintFormat: args.hintFormat,
        });

        runs.push(record);

        console.log(
          `[rp-pi]   → exit=${record.exitCode} timeout=${record.timedOut} duration=${Math.round(record.durationMs / 1000)}s`,
        );
      }
    }
  }

  // Write manifest.
  const manifest: RPManifest = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    benchmarkPath,
    traceRoot,
    outputRoot: outDir,
    model: {
      provider: args.provider,
      model: args.model,
      thinking: args.thinking,
    },
    selection: {
      taskIds: tasks.map((t) => t.taskId),
      replicates: args.replicates,
    },
    options: {
      onMaxSuggestions: args.onMaxSuggestions,
      onHintMode: args.onHintMode,
      timeoutSeconds: args.timeoutSeconds,
      traceStateMode: args.traceStateMode,
    },
    runs,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  // Summary.
  console.log();
  console.log("═══ Summary ═══");
  console.log(`Total runs: ${runs.length}`);
  console.log(`  OFF: ${runs.filter((r) => r.variant === "off").length}`);
  console.log(`  ON: ${runs.filter((r) => r.variant === "on").length}`);
  console.log(`Timeouts: ${runs.filter((r) => r.timedOut).length}`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
