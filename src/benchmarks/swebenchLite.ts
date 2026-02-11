import path from "node:path";

export interface SweBenchLiteTask {
  repo: string;
  instanceId: string;
  baseCommit: string;
  patch: string;
  testPatch: string;
  problemStatement: string;
  hintsText: string;
  createdAt: string | null;
  version: string | null;
  failToPass: string[];
  passToPass: string[];
}

export interface SweBenchLiteTaskPack {
  schemaVersion: 1;
  generatedAtUtc: string;
  source: {
    dataset: string;
    config: string;
    split: string;
    offset: number;
    count: number;
    fetchedAtUtc: string;
    url: string;
  };
  tasks: SweBenchLiteTask[];
}

export interface SweBenchLiteRowsResponse {
  rows: Array<{
    row: Record<string, unknown>;
  }>;
  num_rows_total?: number;
}

const COMMON_STOPWORDS = new Set<string>([
  "and",
  "are",
  "base",
  "bug",
  "case",
  "class",
  "code",
  "commit",
  "error",
  "fail",
  "fails",
  "failure",
  "file",
  "fix",
  "for",
  "from",
  "have",
  "issue",
  "method",
  "module",
  "must",
  "not",
  "path",
  "pytest",
  "python",
  "repo",
  "return",
  "should",
  "test",
  "tests",
  "that",
  "the",
  "this",
  "with",
]);

function parseNumber(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`missing/invalid ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const normalized = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return dedupePreservingOrder(normalized);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parseStringList(parsed);
      } catch {
        // Fall through to plain parsing.
      }
    }

    const pieces = trimmed
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return dedupePreservingOrder(pieces);
  }

  return [];
}

export function normalizeSweBenchLiteRow(
  row: Record<string, unknown>,
): SweBenchLiteTask {
  return {
    repo: requireString(row.repo, "repo"),
    instanceId: requireString(row.instance_id, "instance_id"),
    baseCommit: requireString(row.base_commit, "base_commit"),
    patch: optionalString(row.patch),
    testPatch: optionalString(row.test_patch),
    problemStatement: requireString(row.problem_statement, "problem_statement"),
    hintsText: optionalString(row.hints_text),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    version: typeof row.version === "string" ? row.version : null,
    failToPass: parseStringList(row.FAIL_TO_PASS),
    passToPass: parseStringList(row.PASS_TO_PASS),
  };
}

export function extractPatchFilePaths(patchText: string): string[] {
  const filePaths: string[] = [];
  const seen = new Set<string>();

  for (const line of patchText.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const filePath = match[2]?.trim();
    if (!filePath || seen.has(filePath)) {
      continue;
    }

    seen.add(filePath);
    filePaths.push(filePath);
  }

  return filePaths;
}

function fileStem(filePath: string): string {
  const baseName = path.basename(filePath).toLowerCase();
  const extension = path.extname(baseName);
  if (!extension) {
    return baseName;
  }
  return baseName.slice(0, -extension.length);
}

function extractWordCandidates(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  const candidates = matches.filter((token) => !COMMON_STOPWORDS.has(token));
  return dedupePreservingOrder(candidates);
}

export function buildExpectedPhrases(task: SweBenchLiteTask, maxPhrases = 6): string[] {
  const candidates: string[] = [];

  for (const filePath of extractPatchFilePaths(task.patch)) {
    const stem = fileStem(filePath);
    if (stem.length >= 3) {
      candidates.push(stem);
    }
  }

  for (const testName of task.failToPass) {
    candidates.push(...extractWordCandidates(testName));
  }

  const deduped = dedupePreservingOrder(candidates).slice(0, Math.max(1, maxPhrases));

  if (deduped.length > 0) {
    return deduped;
  }

  const fallback = extractWordCandidates(task.problemStatement).slice(0, maxPhrases);
  if (fallback.length > 0) {
    return fallback;
  }

  return ["fix"];
}

export function buildQueryText(task: SweBenchLiteTask, maxChars = 800): string {
  const parts = [
    `repo: ${task.repo}`,
    `issue: ${task.problemStatement.trim()}`,
    task.hintsText.trim() ? `hints: ${task.hintsText.trim()}` : "",
  ].filter((part) => part.length > 0);

  const joined = parts.join("\n\n");
  if (joined.length <= maxChars) {
    return joined;
  }

  return `${joined.slice(0, maxChars)}...`;
}

export function buildTaskPrompt(task: SweBenchLiteTask): string {
  const failToPassText = task.failToPass.length
    ? task.failToPass.map((value) => `- ${value}`).join("\n")
    : "- (not provided)";

  const passToPassText = task.passToPass.length
    ? task.passToPass.map((value) => `- ${value}`).join("\n")
    : "- (not provided)";

  return [
    `SWE-bench Lite task: ${task.instanceId}`,
    `Repository: ${task.repo}`,
    `Base commit: ${task.baseCommit}`,
    "",
    "Problem statement:",
    task.problemStatement.trim(),
    "",
    "Hints:",
    task.hintsText.trim() || "(none)",
    "",
    "FAIL_TO_PASS tests:",
    failToPassText,
    "",
    "PASS_TO_PASS tests:",
    passToPassText,
  ].join("\n");
}

export function parseSweBenchLiteFetchArgs(argv: string[]): {
  dataset: string;
  config: string;
  split: string;
  offset: number;
  count: number;
  pageSize: number;
  out: string;
} {
  const options = {
    dataset: "princeton-nlp/SWE-bench_Lite",
    config: "default",
    split: "test",
    offset: 0,
    count: 50,
    pageSize: 50,
    out: ".happy-paths/benchmarks/swebench_lite_50/tasks.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--dataset") {
      options.dataset = String(value);
      index += 1;
      continue;
    }
    if (token === "--config") {
      options.config = String(value);
      index += 1;
      continue;
    }
    if (token === "--split") {
      options.split = String(value);
      index += 1;
      continue;
    }
    if (token === "--offset") {
      options.offset = Math.max(0, parseNumber(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--count") {
      options.count = Math.max(1, parseNumber(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--page-size") {
      options.pageSize = Math.max(1, parseNumber(String(value), token));
      index += 1;
      continue;
    }
    if (token === "--out") {
      options.out = String(value);
      index += 1;
    }
  }

  return options;
}
