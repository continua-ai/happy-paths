#!/usr/bin/env node

import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import { parseSweBenchSessionId } from "../src/benchmarks/swebenchTrajectory.js";

type TraceEventRecord = {
  id: string;
  timestamp: string;
  sessionId: string;
  [key: string]: unknown;
};

function parseArgs(argv: string[]): {
  traceRoot: string;
  outRoot: string | null;
  sessionIdPrefix: string;
} {
  const options = {
    traceRoot: ".happy-paths/benchmarks/swebench_lite_50/traces",
    outRoot: null as string | null,
    sessionIdPrefix: "swebench",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--trace-root") {
      options.traceRoot = String(value);
      index += 1;
      continue;
    }

    if (token === "--out-root") {
      options.outRoot = String(value);
      index += 1;
      continue;
    }

    if (token === "--session-id-prefix") {
      options.sessionIdPrefix = String(value);
      index += 1;
    }
  }

  return options;
}

async function collectJsonlFiles(rootPath: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = `${currentPath}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl") {
        output.push(absolutePath);
      }
    }
  }

  await walk(rootPath);
  return output;
}

function parseJsonlRecords(raw: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed line
    }
  }

  return records;
}

function toTraceEventRecord(record: Record<string, unknown>): TraceEventRecord | null {
  if (
    typeof record.id !== "string" ||
    typeof record.timestamp !== "string" ||
    typeof record.sessionId !== "string"
  ) {
    return null;
  }

  return record as TraceEventRecord;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const traceRoot = resolve(repoRoot, options.traceRoot);
  const outRoot = resolve(repoRoot, options.outRoot ?? `${options.traceRoot}_clean`);

  const files = await collectJsonlFiles(traceRoot);
  const eventsBySessionId = new Map<string, Map<string, TraceEventRecord>>();

  let eventCount = 0;
  let skippedNonSwebenchSessionEvents = 0;
  let duplicateEventsDiscarded = 0;

  for (const filePath of files) {
    const records = parseJsonlRecords(await readFile(filePath, "utf-8"));
    for (const record of records) {
      const event = toTraceEventRecord(record);
      if (!event) {
        continue;
      }

      const session = parseSweBenchSessionId(event.sessionId, options.sessionIdPrefix);
      if (!session) {
        skippedNonSwebenchSessionEvents += 1;
        continue;
      }

      eventCount += 1;
      const bucket =
        eventsBySessionId.get(event.sessionId) ?? new Map<string, TraceEventRecord>();
      if (bucket.has(event.id)) {
        duplicateEventsDiscarded += 1;
        eventsBySessionId.set(event.sessionId, bucket);
        continue;
      }

      bucket.set(event.id, event);
      eventsBySessionId.set(event.sessionId, bucket);
    }
  }

  await rm(outRoot, { recursive: true, force: true });

  const sessionFiles: string[] = [];
  for (const [sessionId, eventsById] of eventsBySessionId.entries()) {
    const events = [...eventsById.values()].sort((left, right) => {
      if (left.timestamp < right.timestamp) {
        return -1;
      }
      if (left.timestamp > right.timestamp) {
        return 1;
      }
      return left.id.localeCompare(right.id);
    });

    const outPath = resolve(outRoot, "sessions", `${sessionId}.jsonl`);
    await mkdir(dirname(outPath), { recursive: true });

    const encoded = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    await writeFile(outPath, encoded, "utf-8");
    sessionFiles.push(outPath);
  }

  const summary = {
    sourceTraceRoot: traceRoot,
    canonicalTraceRoot: outRoot,
    filesScanned: files.length,
    swebenchEventsParsed: eventCount,
    skippedNonSwebenchSessionEvents,
    duplicateEventsDiscarded,
    canonicalSessionCount: sessionFiles.length,
    canonicalSessionFiles: sessionFiles,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
