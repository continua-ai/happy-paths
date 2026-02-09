#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

interface Finding {
  file: string;
  line: number;
  kind: "setTimeout" | "setInterval" | "sleep";
  snippet: string;
}

const ALLOW_COMMENT = /happy-paths:\s*allow-(timers|sleep)/i;

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

function isTestFile(file: string): boolean {
  if (!file.startsWith("tests/")) {
    return false;
  }

  const ext = path.extname(file);
  return ext === ".ts" || ext === ".tsx";
}

function scanFile(file: string): Finding[] {
  const contents = readFileSync(file, "utf-8");
  const findings: Finding[] = [];

  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      continue;
    }

    if (ALLOW_COMMENT.test(line)) {
      continue;
    }

    const kind = line.includes("setTimeout(")
      ? ("setTimeout" as const)
      : line.includes("setInterval(")
        ? ("setInterval" as const)
        : /\bsleep\s*\(/.test(line)
          ? ("sleep" as const)
          : null;

    if (!kind) {
      continue;
    }

    findings.push({
      file,
      line: i + 1,
      kind,
      snippet: line.slice(0, 240),
    });
  }

  return findings;
}

function main(): void {
  const files = gitLsFiles().filter(isTestFile);
  const findings: Finding[] = [];

  for (const file of files) {
    findings.push(...scanFile(file));
  }

  if (findings.length === 0) {
    process.exitCode = 0;
    return;
  }

  console.error(
    "ERROR: Found wall-clock timer usage in tests (avoid sleep-based polling).",
  );
  console.error(
    "Prefer event-driven waits (server listen callbacks, explicit promises, condition-based wait-for with deadlines).",
  );
  console.error(
    "If absolutely necessary, add an inline allow comment: `// happy-paths: allow-timers`.",
  );
  console.error("");

  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} [${finding.kind}] ${finding.snippet}`,
    );
  }

  process.exitCode = 2;
}

main();
