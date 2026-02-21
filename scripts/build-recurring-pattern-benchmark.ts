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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  ALL_TEMPLATES,
  ALL_TRAPS,
} from "../src/benchmarks/recurringPatternTemplates.js";

function parseArgs(argv: string[]): { out: string } {
  let out = ".happy-paths/benchmarks/recurring-pattern";

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = argv[i + 1];
      i += 1;
    }
  }

  return { out };
}

function createRepoDirectory(
  baseDir: string,
  templateId: string,
  files: Record<string, string>,
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

  console.log("═══ Recurring-pattern benchmark builder ═══");
  console.log(`Output: ${outDir}`);
  console.log();

  // Create output directory.
  mkdirSync(outDir, { recursive: true });

  // Create repo directories.
  console.log(`Creating ${ALL_TEMPLATES.length} repo templates...`);
  const repoPaths: Record<string, string> = {};

  for (const template of ALL_TEMPLATES) {
    console.log(`  📁 ${template.templateId}: ${template.description.slice(0, 80)}...`);
    const repoDir = createRepoDirectory(outDir, template.templateId, template.files);
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
    templates: ALL_TEMPLATES,
    tasks: ALL_TASKS,
    trapIndex,
  };

  const packPath = join(outDir, "benchmark.json");
  writeFileSync(packPath, JSON.stringify(pack, null, 2), "utf-8");
  console.log(`Wrote task pack: ${packPath}`);

  // Print summary.
  console.log();
  console.log("═══ Summary ═══");
  console.log(`Templates: ${ALL_TEMPLATES.length}`);
  console.log(`Tasks: ${ALL_TASKS.length}`);
  console.log(`Unique traps: ${ALL_TRAPS.length}`);
  console.log();

  // Trap recurrence matrix.
  const recurrence = trapRecurrenceCounts(ALL_TASKS);
  const trapTasks = tasksByTrap(ALL_TASKS);

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
