#!/usr/bin/env node

/**
 * Analyze reinvention benchmark results.
 *
 * Unlike the recurring-pattern benchmark (which measures wall time / errors),
 * this measures TOKEN WASTE: how many tokens were spent on throwaway heredoc
 * scripts vs using existing repo tools.
 *
 * Reads session JSONL files from a benchmark run and computes:
 * - Total heredoc lines / estimated tokens per session
 * - Whether the agent used the repo's CLI tool (./track, ./ops, jq)
 * - Tool call count, wall time, task success
 * - OFF vs ON comparison
 *
 * Usage:
 *   tsx scripts/analyze-reinvention-results.ts \
 *     --results /tmp/rp-results-reinvention \
 *     --trace-root /tmp/rp-traces-reinvention
 */

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

interface SessionMetrics {
  sessionId: string;
  taskId: string;
  variant: "off" | "on";
  replicate: string;
  durationMs: number;
  totalToolCalls: number;
  heredocCount: number;
  heredocLines: number;
  heredocEstTokens: number;
  cliUsageCount: number; // times ./track, ./ops, or jq was used
  jqUsageCount: number;
  taskSuccess: boolean;
  exitCode: number;
}

function parseSessionId(sid: string): {
  taskId: string;
  variant: "off" | "on";
  replicate: string;
} | null {
  const parts = sid.split("::");
  if (parts.length < 3 || parts[0] !== "rp") return null;
  const variant = parts[2] as "off" | "on";
  if (variant !== "off" && variant !== "on") return null;
  return {
    taskId: parts[1] ?? "",
    variant,
    replicate: parts[3] ?? "r1",
  };
}

function isHeredoc(cmd: string): boolean {
  return /python3?\s+(-\s+)?<</.test(cmd);
}

function isCliUsage(cmd: string): boolean {
  return (
    /\.\/track\s/.test(cmd) ||
    /\.\/ops\s/.test(cmd) ||
    /^jq\s/.test(cmd.trim()) ||
    /\|\s*jq\s/.test(cmd)
  );
}

function isJqUsage(cmd: string): boolean {
  return /^jq\s/.test(cmd.trim()) || /\|\s*jq\s/.test(cmd);
}

interface ManifestRun {
  taskId: string;
  variant: string;
  replicate: number;
  sessionId: string;
  durationMs: number;
  exitCode: number;
}

interface Manifest {
  runs: ManifestRun[];
}

async function analyzeSession(
  sessionPath: string,
  run: ManifestRun,
): Promise<SessionMetrics> {
  const parsed = parseSessionId(run.sessionId);
  const metrics: SessionMetrics = {
    sessionId: run.sessionId,
    taskId: parsed?.taskId ?? run.taskId,
    variant: (parsed?.variant ?? run.variant) as "off" | "on",
    replicate: parsed?.replicate ?? `r${run.replicate}`,
    durationMs: run.durationMs,
    totalToolCalls: 0,
    heredocCount: 0,
    heredocLines: 0,
    heredocEstTokens: 0,
    cliUsageCount: 0,
    jqUsageCount: 0,
    taskSuccess: run.exitCode === 0,
    exitCode: run.exitCode,
  };

  if (!existsSync(sessionPath)) {
    return metrics;
  }

  const content = await readFile(sessionPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    let event: {
      type?: string;
      payload?: { toolName?: string; command?: string; input?: { command?: string } };
      message?: { role?: string; content?: unknown[] };
    };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    // Happy Paths trace format: tool_call events have payload.toolName + payload.command
    if (event.type === "tool_call" && event.payload?.toolName === "bash") {
      const cmd = event.payload.command ?? event.payload.input?.command ?? "";
      metrics.totalToolCalls += 1;

      if (isHeredoc(cmd)) {
        metrics.heredocCount += 1;
        const cmdLines = cmd.split("\n").length;
        metrics.heredocLines += cmdLines;
        metrics.heredocEstTokens += Math.round(cmd.length / 4);
      }
      if (isCliUsage(cmd)) {
        metrics.cliUsageCount += 1;
      }
      if (isJqUsage(cmd)) {
        metrics.jqUsageCount += 1;
      }
      continue;
    }

    // Also check Pi session format: message events with toolCall blocks
    if (event.type !== "message") continue;
    const msg = event.message;
    if (!msg || msg.role !== "assistant") continue;
    const blocks = msg.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (
        typeof block !== "object" ||
        block === null ||
        (block as { type?: string }).type !== "toolCall"
      )
        continue;
      const b = block as { name?: string; arguments?: { command?: string } };
      if (b.name?.toLowerCase() !== "bash") continue;

      const cmd = b.arguments?.command ?? "";
      metrics.totalToolCalls += 1;

      if (isHeredoc(cmd)) {
        metrics.heredocCount += 1;
        const cmdLines = cmd.split("\n").length;
        metrics.heredocLines += cmdLines;
        metrics.heredocEstTokens += Math.round(cmd.length / 4);
      }
      if (isCliUsage(cmd)) {
        metrics.cliUsageCount += 1;
      }
      if (isJqUsage(cmd)) {
        metrics.jqUsageCount += 1;
      }
    }
  }

  return metrics;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let resultsDir = "";
  let traceRoot = "";

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    const val = args[i + 1];
    if (tok === "--results" && val) {
      resultsDir = resolve(val);
      i++;
    } else if (tok === "--trace-root" && val) {
      traceRoot = resolve(val);
      i++;
    }
  }

  if (!resultsDir) {
    console.error("Usage: --results <dir> [--trace-root <dir>]");
    process.exit(1);
  }

  // Load manifest
  const manifestPath = join(resultsDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  // Find session files — support both flat and isolated trace layouts.
  const sessionsDir = traceRoot
    ? join(traceRoot, "sessions")
    : join(resultsDir, "sessions");

  /**
   * Locate the session JSONL for a run. In isolated mode, sessions live at
   * `<traceRoot>/isolated/<taskId>/r<N>/sessions/<sessionId>.jsonl`.
   * In shared mode, they're at `<traceRoot>/sessions/<sessionId>.jsonl`.
   */
  function findSessionPath(run: ManifestRun): string {
    const sessionFile = `${run.sessionId}.jsonl`;
    // Try flat first
    const flat = join(sessionsDir, sessionFile);
    if (existsSync(flat)) return flat;
    // Try isolated layout
    if (traceRoot) {
      const taskSlug = run.taskId.replace(/[^a-zA-Z0-9_-]/g, "-");
      const isolated = join(
        traceRoot,
        "isolated",
        taskSlug,
        `r${run.replicate}`,
        "sessions",
        sessionFile,
      );
      if (existsSync(isolated)) return isolated;
    }
    return flat; // fallback
  }

  // Analyze each run
  const allMetrics: SessionMetrics[] = [];

  for (const run of manifest.runs) {
    const sessionPath = findSessionPath(run);
    const metrics = await analyzeSession(sessionPath, run);
    allMetrics.push(metrics);
  }

  // Group by task + variant
  const byTaskVariant = new Map<string, SessionMetrics[]>();
  for (const m of allMetrics) {
    const key = `${m.taskId}::${m.variant}`;
    const arr = byTaskVariant.get(key) ?? [];
    arr.push(m);
    byTaskVariant.set(key, arr);
  }

  // Print results
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  REINVENTION BENCHMARK RESULTS");
  console.log("═══════════════════════════════════════════════════════════════");

  // Get unique task IDs
  const taskIds = [...new Set(allMetrics.map((m) => m.taskId))].sort();

  console.log("\n  Per-task comparison (OFF = no hints, ON = tool-call hints):\n");
  console.log(
    `  ${"Task".padEnd(40)} ${"Var".padEnd(4)} ${"Heredocs".padStart(8)} ${"H.Lines".padStart(8)} ${"H.Tokens".padStart(8)} ${"CLI use".padStart(8)} ${"jq use".padStart(8)} ${"Calls".padStart(6)} ${"Time".padStart(8)} ${"OK".padStart(3)}`,
  );
  console.log(
    `  ${"─".repeat(40)} ${"─".repeat(4)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(3)}`,
  );

  for (const taskId of taskIds) {
    for (const variant of ["off", "on"] as const) {
      const runs = byTaskVariant.get(`${taskId}::${variant}`) ?? [];
      if (runs.length === 0) continue;

      const avg = (arr: number[]) =>
        arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const median = (arr: number[]) => {
        const s = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
      };

      const heredocs = median(runs.map((r) => r.heredocCount));
      const hLines = median(runs.map((r) => r.heredocLines));
      const hTokens = median(runs.map((r) => r.heredocEstTokens));
      const cli = median(runs.map((r) => r.cliUsageCount));
      const jq = median(runs.map((r) => r.jqUsageCount));
      const calls = median(runs.map((r) => r.totalToolCalls));
      const time = median(runs.map((r) => r.durationMs));
      const successes = runs.filter((r) => r.taskSuccess).length;

      const shortTask = taskId.length > 38 ? taskId.slice(0, 38) : taskId;

      console.log(
        `  ${shortTask.padEnd(40)} ${variant.padEnd(4)} ${String(Math.round(heredocs)).padStart(8)} ${String(Math.round(hLines)).padStart(8)} ${String(Math.round(hTokens)).padStart(8)} ${String(Math.round(cli)).padStart(8)} ${String(Math.round(jq)).padStart(8)} ${String(Math.round(calls)).padStart(6)} ${String(Math.round(time / 1000)) + "s".padStart(8)} ${`${successes}/${runs.length}`.padStart(3)}`,
      );
    }
  }

  // Summary
  const offRuns = allMetrics.filter((m) => m.variant === "off");
  const onRuns = allMetrics.filter((m) => m.variant === "on");

  const sumTokens = (runs: SessionMetrics[]) =>
    runs.reduce((a, r) => a + r.heredocEstTokens, 0);
  const sumCli = (runs: SessionMetrics[]) =>
    runs.reduce((a, r) => a + r.cliUsageCount, 0);
  const sumHeredocs = (runs: SessionMetrics[]) =>
    runs.reduce((a, r) => a + r.heredocCount, 0);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(
    `  OFF: ${offRuns.length} runs, ${sumHeredocs(offRuns)} heredocs, ~${sumTokens(offRuns)} wasted tokens, ${sumCli(offRuns)} CLI uses`,
  );
  console.log(
    `  ON:  ${onRuns.length} runs, ${sumHeredocs(onRuns)} heredocs, ~${sumTokens(onRuns)} wasted tokens, ${sumCli(onRuns)} CLI uses`,
  );

  if (offRuns.length > 0 && onRuns.length > 0) {
    const offAvgTokens = sumTokens(offRuns) / offRuns.length;
    const onAvgTokens = sumTokens(onRuns) / onRuns.length;
    const tokenDelta = ((onAvgTokens - offAvgTokens) / offAvgTokens) * 100;
    const offAvgCli = sumCli(offRuns) / offRuns.length;
    const onAvgCli = sumCli(onRuns) / onRuns.length;

    console.log(
      `\n  Token waste delta: ${tokenDelta > 0 ? "+" : ""}${tokenDelta.toFixed(1)}% (${tokenDelta < 0 ? "LESS" : "MORE"} waste with hints)`,
    );
    console.log(
      `  CLI usage: OFF avg=${offAvgCli.toFixed(1)}, ON avg=${onAvgCli.toFixed(1)}`,
    );
  }

  // Write JSON summary
  const summaryPath = join(resultsDir, "reinvention_analysis.json");
  const summary = {
    generatedAtUtc: new Date().toISOString(),
    totalRuns: allMetrics.length,
    offRuns: offRuns.length,
    onRuns: onRuns.length,
    off: {
      totalHeredocs: sumHeredocs(offRuns),
      totalHeredocTokens: sumTokens(offRuns),
      totalCliUsage: sumCli(offRuns),
      avgHeredocTokensPerRun: offRuns.length ? sumTokens(offRuns) / offRuns.length : 0,
    },
    on: {
      totalHeredocs: sumHeredocs(onRuns),
      totalHeredocTokens: sumTokens(onRuns),
      totalCliUsage: sumCli(onRuns),
      avgHeredocTokensPerRun: onRuns.length ? sumTokens(onRuns) / onRuns.length : 0,
    },
    perTask: taskIds.map((taskId) => ({
      taskId,
      off:
        byTaskVariant.get(`${taskId}::off`)?.map((m) => ({
          heredocCount: m.heredocCount,
          heredocTokens: m.heredocEstTokens,
          cliUsage: m.cliUsageCount,
          jqUsage: m.jqUsageCount,
          totalCalls: m.totalToolCalls,
          durationMs: m.durationMs,
          success: m.taskSuccess,
        })) ?? [],
      on:
        byTaskVariant.get(`${taskId}::on`)?.map((m) => ({
          heredocCount: m.heredocCount,
          heredocTokens: m.heredocEstTokens,
          cliUsage: m.cliUsageCount,
          jqUsage: m.jqUsageCount,
          totalCalls: m.totalToolCalls,
          durationMs: m.durationMs,
          success: m.taskSuccess,
        })) ?? [],
    })),
  };

  const { writeFile: wf } = await import("node:fs/promises");
  await wf(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  console.log(`\n  Analysis written to: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
