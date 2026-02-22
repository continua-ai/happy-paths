#!/usr/bin/env node

/**
 * Build the recurring-pattern benchmark.
 *
 * Creates repo directories, initializes git repos, and writes a task pack JSON.
 *
 * Usage:
 *   tsx scripts/build-recurring-pattern-benchmark.ts --out /tmp/rp-benchmark
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  RecurringPatternBenchmarkPack,
  RecurringTrap,
} from "../src/benchmarks/recurringPattern.js";
import {
  tasksByTrap,
  trapRecurrenceCounts,
} from "../src/benchmarks/recurringPattern.js";
import {
  ALL_TASKS,
  ALL_TASKS_WITH_REINVENTION,
  ALL_TEMPLATES,
  ALL_TEMPLATES_WITH_REINVENTION,
  ALL_TRAPS,
  DATAQUERY_AGENTS_MD,
  ISSUETRACKER_AGENTS_MD,
  OPSBOARD_AGENTS_MD,
} from "../src/benchmarks/recurringPatternTemplates.js";

function parseArgs(argv: string[]): {
  out: string;
  includeReinvention: boolean;
  withAgentsMd: boolean;
} {
  let out = ".happy-paths/benchmarks/recurring-pattern";
  let includeReinvention = false;
  let withAgentsMd = false;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = argv[i + 1] ?? out;
      i += 1;
    }
    if (argv[i] === "--include-reinvention") {
      includeReinvention = true;
    }
    if (argv[i] === "--with-agents-md") {
      withAgentsMd = true;
    }
  }

  return { out, includeReinvention, withAgentsMd };
}

function createRepoDirectory(
  baseDir: string,
  templateId: string,
  files: Record<string, string>,
  executablePaths?: string[],
): string {
  const repoDir = join(baseDir, "repos", templateId);

  if (existsSync(repoDir)) {
    console.log(`  ⏭  Repo directory already exists: ${repoDir}`);
    return repoDir;
  }

  mkdirSync(repoDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(repoDir, relPath);
    const dirName = fullPath.substring(0, fullPath.lastIndexOf("/"));
    mkdirSync(dirName, { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  // Make specified files executable.
  for (const relPath of executablePaths ?? []) {
    chmodSync(join(repoDir, relPath), 0o755);
  }

  // Initialize git repo and make initial commit.
  execSync("git init", { cwd: repoDir, stdio: "pipe" });
  execSync("git add -A", { cwd: repoDir, stdio: "pipe" });
  execSync('git commit -m "initial: benchmark repo template"', {
    cwd: repoDir,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "benchmark",
      GIT_AUTHOR_EMAIL: "benchmark@example.com",
      GIT_COMMITTER_NAME: "benchmark",
      GIT_COMMITTER_EMAIL: "benchmark@example.com",
    },
  });

  return repoDir;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);

  const templates = args.includeReinvention
    ? ALL_TEMPLATES_WITH_REINVENTION
    : ALL_TEMPLATES;
  const tasks = args.includeReinvention ? ALL_TASKS_WITH_REINVENTION : ALL_TASKS;

  console.log("═══ Recurring-pattern benchmark builder ═══");
  console.log(`Output: ${outDir}`);
  if (args.includeReinvention) {
    console.log("Including reinvention benchmark repos.");
  }
  console.log();

  // Create output directory.
  mkdirSync(outDir, { recursive: true });

  // Create repo directories.
  console.log(`Creating ${templates.length} repo templates...`);
  const repoPaths: Record<string, string> = {};

  // AGENTS.md injection map (only for reinvention repos, only when --with-agents-md)
  const agentsMdMap: Record<string, string> = {
    issuetracker: ISSUETRACKER_AGENTS_MD,
    opsboard: OPSBOARD_AGENTS_MD,
    dataquery: DATAQUERY_AGENTS_MD,
  };

  for (const template of templates) {
    console.log(`  📁 ${template.templateId}: ${template.description.slice(0, 80)}...`);

    // Inject AGENTS.md for reinvention repos when requested.
    const files = { ...template.files };
    if (args.withAgentsMd && agentsMdMap[template.templateId]) {
      files["AGENTS.md"] = agentsMdMap[template.templateId];
      console.log("     + AGENTS.md (tool registry)");
    }

    const repoDir = createRepoDirectory(
      outDir,
      template.templateId,
      files,
      template.executablePaths,
    );
    repoPaths[template.templateId] = repoDir;

    // Capture the base commit SHA.
    const sha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    console.log(`     commit: ${sha.slice(0, 8)}`);
  }
  console.log();

  // Build trap index.
  const trapIndex: Record<string, RecurringTrap> = {};
  for (const trap of ALL_TRAPS) {
    trapIndex[trap.trapId] = trap;
  }

  // Build and write the task pack.
  const pack: RecurringPatternBenchmarkPack = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    description:
      "Recurring-pattern benchmark for Happy Paths. Tasks share failure modes across repos.",
    templates,
    tasks,
    trapIndex,
  };

  const packPath = join(outDir, "benchmark.json");
  writeFileSync(packPath, JSON.stringify(pack, null, 2), "utf-8");
  console.log(`Wrote task pack: ${packPath}`);

  // Print summary.
  console.log();
  console.log("═══ Summary ═══");
  console.log(`Templates: ${templates.length}`);
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Unique traps: ${ALL_TRAPS.length}`);
  console.log();

  // Trap recurrence matrix.
  const recurrence = trapRecurrenceCounts(tasks);
  const trapTasks = tasksByTrap(tasks);

  console.log("Trap recurrence (how many tasks share each trap):");
  for (const [trapId, count] of [...recurrence.entries()].sort((a, b) => b[1] - a[1])) {
    const trap = trapIndex[trapId];
    const family = trap?.family ?? "?";
    const tasks = trapTasks.get(trapId) ?? [];
    console.log(`  ${trapId} [${family}]: ${count} tasks`);
    console.log(`    tasks: ${tasks.join(", ")}`);
  }
  console.log();

  console.log("Error families:");
  const familyCounts = new Map<string, number>();
  for (const trap of ALL_TRAPS) {
    familyCounts.set(trap.family, (familyCounts.get(trap.family) ?? 0) + 1);
  }
  for (const [family, count] of [...familyCounts.entries()].sort()) {
    console.log(`  ${family}: ${count} traps`);
  }
  console.log();

  // Verify repos.
  console.log("Verifying repos...");
  for (const template of ALL_TEMPLATES) {
    const repoDir = repoPaths[template.templateId];
    if (!repoDir) {
      console.log(`  ❌ ${template.templateId}: missing repo path`);
      continue;
    }

    const gitStatus = execSync("git status --porcelain", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    if (gitStatus.length > 0) {
      console.log(`  ⚠  ${template.templateId}: dirty working tree`);
    } else {
      console.log(`  ✅ ${template.templateId}: clean git repo`);
    }
  }

  console.log();
  console.log("Done. Next: run the benchmark with scripts/run-recurring-pattern-pi.ts");
}

main();
