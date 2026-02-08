#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WARN_DEFAULT = 1200;
const FAIL_DEFAULT = 2000;
const ALLOW_GROWTH_DEFAULT = 0;
const DEFAULT_ALLOWLIST = ".github/large_source_file_allowlist.json";

const ALLOWED_SUFFIXES = new Set([
  ".go",
  ".java",
  ".kt",
  ".proto",
  ".py",
  ".pyi",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
]);

const SKIP_PATH_PARTS = new Set([
  ".git",
  ".venv",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

function parseArgs(argv) {
  const options = {
    base: process.env.BASE_REF,
    warnLines: WARN_DEFAULT,
    failLines: FAIL_DEFAULT,
    allowGrowthLines: ALLOW_GROWTH_DEFAULT,
    allowlistFile: DEFAULT_ALLOWLIST,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];

    if (token === "--base") {
      options.base = value;
      i += 1;
      continue;
    }
    if (token === "--warn-lines") {
      options.warnLines = Number(value);
      i += 1;
      continue;
    }
    if (token === "--fail-lines") {
      options.failLines = Number(value);
      i += 1;
      continue;
    }
    if (token === "--allow-growth-lines") {
      options.allowGrowthLines = Number(value);
      i += 1;
      continue;
    }
    if (token === "--allowlist-file") {
      options.allowlistFile = value;
      i += 1;
    }
  }

  return options;
}

function git(args, { allowDiffRc1 = false, cwd } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
  });

  if (allowDiffRc1 && (result.status === 0 || result.status === 1)) {
    return result.stdout ?? "";
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim() || "(no stderr)";
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${stderr}`);
  }

  return result.stdout ?? "";
}

function repoRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || "").trim() || "git rev-parse failed");
  }
  const root = (result.stdout || "").trim();
  if (!root) {
    throw new Error("git rev-parse returned empty repo root");
  }
  return root;
}

function toPosixRelative(input) {
  return (input || "").trim().replaceAll(path.sep, "/");
}

function parseNameStatus(output) {
  const entries = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parts = line.split("\t");
    const status = parts[0];
    const code = status.slice(0, 1);

    if (code === "R") {
      if (parts.length >= 3) {
        entries.push({
          status: code,
          oldPath: toPosixRelative(parts[1]),
          path: toPosixRelative(parts[2]),
        });
      }
      continue;
    }

    if (parts.length >= 2) {
      entries.push({
        status: code,
        path: toPosixRelative(parts[1]),
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);
    deduped.push(entry);
  }
  return deduped;
}

function isCandidatePath(relativePath) {
  const suffix = path.extname(relativePath);
  if (!ALLOWED_SUFFIXES.has(suffix)) {
    return false;
  }

  for (const part of relativePath.split("/")) {
    if (SKIP_PATH_PARTS.has(part)) {
      return false;
    }
  }

  return true;
}

function countPhysicalLines(data) {
  if (data.length === 0) {
    return 0;
  }

  if (data.includes(10)) {
    let lines = 0;
    for (const byte of data) {
      if (byte === 10) {
        lines += 1;
      }
    }
    if (data[data.length - 1] !== 10) {
      lines += 1;
    }
    return lines;
  }

  let lines = 0;
  for (const byte of data) {
    if (byte === 13) {
      lines += 1;
    }
  }
  if (lines === 0) {
    return 1;
  }
  if (data[data.length - 1] !== 13) {
    lines += 1;
  }
  return lines;
}

async function worktreeLineCount(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  const data = await readFile(absolutePath);
  return countPhysicalLines(data);
}

function gitRefLineCount(root, ref, relativePath) {
  if (!ref) {
    return null;
  }
  const result = spawnSync("git", ["--no-pager", "show", `${ref}:${relativePath}`], {
    cwd: root,
    encoding: null,
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  return countPhysicalLines(result.stdout);
}

async function loadAllowlist(root, allowlistPath) {
  if (!allowlistPath) {
    return new Map();
  }

  const absolute = path.join(root, allowlistPath);
  if (!existsSync(absolute)) {
    return new Map();
  }

  const raw = await readFile(absolute, "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Allowlist must be a JSON object: ${allowlistPath}`);
  }

  const out = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    let reason = "";
    if (typeof value === "string") {
      reason = value;
    }
    if (value && typeof value === "object" && typeof value.reason === "string") {
      reason = value.reason;
    }
    out.set(toPosixRelative(key), reason);
  }
  return out;
}

function classifyChange(beforeLines, afterLines, failLines, allowGrowthLines) {
  if (afterLines <= failLines) {
    return null;
  }

  if (beforeLines === null) {
    return "new_over_limit";
  }

  if (beforeLines <= failLines) {
    return "crossed_limit";
  }

  if (afterLines > beforeLines + allowGrowthLines) {
    return "grew_over_limit";
  }

  return null;
}

async function changedPaths(root, base) {
  if (!base) {
    const tracked = git(["--no-pager", "ls-files"], { cwd: root });
    return tracked
      .split(/\r?\n/)
      .filter(Boolean)
      .map((entry) => ({ status: "A", path: toPosixRelative(entry) }));
  }

  const diff = git(
    ["--no-pager", "diff", "--name-status", "-M", "--diff-filter=AMR", base],
    { cwd: root, allowDiffRc1: true },
  );
  const changed = parseNameStatus(diff);

  const untracked = git(["--no-pager", "ls-files", "--others", "--exclude-standard"], {
    cwd: root,
  });

  const seen = new Set(changed.map((entry) => entry.path));
  for (const rawPath of untracked.split(/\r?\n/)) {
    const rel = toPosixRelative(rawPath);
    if (!rel || seen.has(rel)) {
      continue;
    }
    seen.add(rel);
    changed.push({ status: "A", path: rel });
  }

  return changed;
}

function printSummary(options, warnings, errors) {
  console.error("Large source file guardrail (changed files only)");
  console.error(`- warn if LOC >= ${options.warnLines}`);
  console.error(`- fail if LOC > ${options.failLines}`);
  console.error(
    `- existing >${options.failLines} LOC files may grow by at most ${options.allowGrowthLines} LOC`,
  );

  if (warnings.length > 0) {
    console.error("\nWarnings:");
    for (const warning of warnings.sort((a, b) => b.lines - a.lines)) {
      console.error(`- ${warning.lines} LOC  ${warning.path}`);
    }
  }

  if (errors.length > 0) {
    console.error("\nErrors (fails):");
    for (const error of errors.sort((a, b) => b.afterLines - a.afterLines)) {
      const before = error.beforeLines === null ? "(new)" : String(error.beforeLines);
      console.error(
        `- ${error.afterLines} LOC (before ${before})  ${error.path}  [${error.kind}]`,
      );
    }
    console.error("\nEscape hatch (generated/bundled files only):");
    console.error(`- Add an entry to ${options.allowlistFile}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.warnLines <= 0 || options.failLines <= 0) {
    throw new Error("--warn-lines and --fail-lines must be positive");
  }
  if (options.warnLines >= options.failLines) {
    throw new Error("--warn-lines must be < --fail-lines");
  }
  if (options.allowGrowthLines < 0) {
    throw new Error("--allow-growth-lines must be >= 0");
  }

  const root = repoRoot();
  const allowlist = await loadAllowlist(root, options.allowlistFile);
  const changed = await changedPaths(root, options.base);

  const warnings = [];
  const errors = [];

  for (const item of changed) {
    const relativePath = item.path;
    if (!isCandidatePath(relativePath)) {
      continue;
    }
    if (allowlist.has(relativePath)) {
      continue;
    }

    const afterLines = await worktreeLineCount(root, relativePath);
    if (afterLines === null) {
      continue;
    }

    if (afterLines >= options.warnLines && afterLines <= options.failLines) {
      warnings.push({
        path: relativePath,
        lines: afterLines,
      });
    }

    const basePath = item.oldPath ?? relativePath;
    const beforeLines = options.base
      ? gitRefLineCount(root, options.base, basePath)
      : null;

    const kind = classifyChange(
      beforeLines,
      afterLines,
      options.failLines,
      options.allowGrowthLines,
    );

    if (kind) {
      errors.push({
        path: relativePath,
        beforeLines,
        afterLines,
        kind,
      });
    }
  }

  if (warnings.length > 0 || errors.length > 0) {
    printSummary(options, warnings, errors);
  }

  if (errors.length > 0) {
    process.exitCode = 2;
    return;
  }

  process.exitCode = 0;
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
