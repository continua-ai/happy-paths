#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const SCOPED_DIR_PREFIXES = ["src/", "scripts/", "tests/", "examples/"] as const;

function gitLsFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], {
    encoding: null,
  });

  if (result.status !== 0) {
    const stderr = Buffer.from(result.stderr ?? "")
      .toString("utf-8")
      .trim();
    throw new Error(`git ls-files failed: ${stderr || "(no stderr)"}`);
  }

  const raw = Buffer.from(result.stdout ?? "");
  return raw
    .toString("utf-8")
    .split("\u0000")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isScoped(pathname: string): boolean {
  return SCOPED_DIR_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthoredJavaScript(pathname: string): boolean {
  const ext = path.extname(pathname);
  return ext === ".js" || ext === ".mjs";
}

function main(): void {
  const offending = gitLsFiles().filter(
    (file) => isScoped(file) && isAuthoredJavaScript(file),
  );

  if (offending.length === 0) {
    process.exitCode = 0;
    return;
  }

  console.error(
    "ERROR: Authored JavaScript files are not allowed under src/scripts/tests/examples.",
  );
  console.error("Use TypeScript (.ts/.tsx) instead.");
  console.error("");

  for (const file of offending.sort()) {
    console.error(`- ${file}`);
  }

  process.exitCode = 2;
}

main();
