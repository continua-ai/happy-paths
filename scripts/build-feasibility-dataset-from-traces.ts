#!/usr/bin/env node

import type { Dirent } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseFloatOrUndefined(value) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid number: ${value}`);
  }
  return parsed;
}

function parseFormat(value) {
  if (value === "auto" || value === "trace" || value === "pi") {
    return value;
  }
  throw new Error(`invalid --format value: ${value}`);
}

function parseArgs(argv) {
  const options = {
    traceRoot: ".happy-paths",
    out: "testdata/feasibility_trace_dataset.json",
    harness: "pi",
    scope: "personal",
    queryLimit: 8,
    maxExpectedPhrases: 3,
    maxQueryTextChars: 280,
    maxSignatureChars: 180,
    maxToolOutputChars: 2000,
    requireCommandChange: true,
    format: "auto",
    toolName: "bash",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--trace-root") {
      options.traceRoot = value;
      index += 1;
      continue;
    }
    if (token === "--out") {
      options.out = value;
      index += 1;
      continue;
    }
    if (token === "--harness") {
      options.harness = value;
      index += 1;
      continue;
    }
    if (token === "--scope") {
      options.scope = value;
      index += 1;
      continue;
    }
    if (token === "--query-limit") {
      options.queryLimit = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-expected-phrases") {
      options.maxExpectedPhrases = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-query-text-chars") {
      options.maxQueryTextChars = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-signature-chars") {
      options.maxSignatureChars = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--max-tool-output-chars") {
      options.maxToolOutputChars = parseFloatOrUndefined(value);
      index += 1;
      continue;
    }
    if (token === "--format") {
      options.format = parseFormat(value);
      index += 1;
      continue;
    }
    if (token === "--tool-name") {
      options.toolName = value;
      index += 1;
      continue;
    }
    if (token === "--allow-same-command") {
      options.requireCommandChange = false;
    }
  }

  return options;
}

async function collectJsonlFiles(rootPath) {
  const output = [];

  async function walk(currentPath) {
    let entries: Dirent[];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);
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

function sessionHintFromPath(path) {
  const name = path.split(/[\\/]/).pop() || "session";
  return name.replace(/\.jsonl$/i, "");
}

function parseJsonlRecords(raw) {
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed);
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  return records;
}

function isTraceEventRecord(record) {
  return (
    typeof record.id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.harness === "string" &&
    typeof record.scope === "string" &&
    typeof record.type === "string" &&
    typeof record.payload === "object" &&
    record.payload !== null
  );
}

function dedupeTemplates(templates) {
  const seen = new Set();
  const output = [];
  for (const template of templates) {
    const key = template.id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(template);
  }
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const distPath = resolve(process.cwd(), "dist/index.js");

  const {
    buildWrongTurnDatasetFromTemplates,
    extractWrongTurnScenarioTemplatesFromEvents,
    extractWrongTurnScenarioTemplatesFromPiSessionRecords,
  } = await import(pathToFileURL(distPath).href);

  const traceRoot = resolve(process.cwd(), options.traceRoot);
  const traceFiles = await collectJsonlFiles(traceRoot);

  if (traceFiles.length === 0) {
    throw new Error(`no .jsonl files found under ${traceRoot}`);
  }

  const templates = [];
  let traceEventFilesScanned = 0;
  let piSessionFilesScanned = 0;
  let skippedForFormat = 0;

  for (const traceFile of traceFiles) {
    const raw = await readFile(traceFile, "utf-8");
    const records = parseJsonlRecords(raw);

    if (records.length === 0) {
      continue;
    }

    const traceEvents = records.filter(isTraceEventRecord);
    const shouldUseTraceFormat =
      options.format === "trace" ||
      (options.format === "auto" && traceEvents.length > 0);

    let extracted: Array<{ id?: string }> = [];

    if (shouldUseTraceFormat) {
      if (traceEvents.length === 0) {
        skippedForFormat += 1;
        continue;
      }

      traceEventFilesScanned += 1;
      extracted = extractWrongTurnScenarioTemplatesFromEvents(traceEvents, {
        sessionId: sessionHintFromPath(traceFile),
        harness: options.harness,
        scope: options.scope,
        queryLimit: options.queryLimit,
        maxExpectedPhrases: options.maxExpectedPhrases,
        requireCommandChange: options.requireCommandChange,
        maxQueryTextChars: options.maxQueryTextChars,
        maxSignatureChars: options.maxSignatureChars,
      });
    } else {
      piSessionFilesScanned += 1;
      extracted = extractWrongTurnScenarioTemplatesFromPiSessionRecords(records, {
        sessionId: sessionHintFromPath(traceFile),
        harness: options.harness,
        scope: options.scope,
        queryLimit: options.queryLimit,
        maxExpectedPhrases: options.maxExpectedPhrases,
        requireCommandChange: options.requireCommandChange,
        maxQueryTextChars: options.maxQueryTextChars,
        maxSignatureChars: options.maxSignatureChars,
        maxToolOutputChars: options.maxToolOutputChars,
        toolName: options.toolName,
      });
    }

    templates.push(...extracted);
  }

  const unique = dedupeTemplates(templates);
  const dataset = buildWrongTurnDatasetFromTemplates(unique);

  const outPath = resolve(process.cwd(), options.out);
  await writeFile(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf-8");

  console.log(
    JSON.stringify(
      {
        traceRoot,
        format: options.format,
        toolName: options.toolName,
        maxQueryTextChars: options.maxQueryTextChars,
        maxSignatureChars: options.maxSignatureChars,
        maxToolOutputChars: options.maxToolOutputChars,
        traceFilesFound: traceFiles.length,
        traceEventFilesScanned,
        piSessionFilesScanned,
        skippedForFormat,
        scenariosExtracted: unique.length,
        out: outPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
