import { describe, expect, it } from "vitest";

import {
  buildExpectedPhrases,
  buildQueryText,
  buildTaskPrompt,
  extractPatchFilePaths,
  normalizeSweBenchLiteRow,
  parseStringList,
} from "../src/benchmarks/swebenchLite.js";

describe("swebenchLite helpers", () => {
  it("parses string lists from JSON or plain text", () => {
    expect(parseStringList('["a", "b", "a"]')).toEqual(["a", "b"]);
    expect(parseStringList("first\nsecond\nfirst")).toEqual(["first", "second"]);
    expect(parseStringList(null)).toEqual([]);
  });

  it("normalizes rows from dataset server shape", () => {
    const task = normalizeSweBenchLiteRow({
      repo: "org/repo",
      instance_id: "repo__1",
      base_commit: "abc123",
      patch: "diff --git a/a.py b/a.py",
      test_patch: "",
      problem_statement: "Fix bug in parser",
      hints_text: "Look at parse module",
      FAIL_TO_PASS: '["tests/test_parser.py::test_parse"]',
      PASS_TO_PASS: '["tests/test_parser.py::test_other"]',
      created_at: "2024-01-01",
      version: "1.0",
    });

    expect(task.instanceId).toBe("repo__1");
    expect(task.failToPass).toEqual(["tests/test_parser.py::test_parse"]);
    expect(task.passToPass).toEqual(["tests/test_parser.py::test_other"]);
  });

  it("extracts patched file paths from git diff", () => {
    const patch = [
      "diff --git a/src/foo.py b/src/foo.py",
      "index 123..456 100644",
      "--- a/src/foo.py",
      "+++ b/src/foo.py",
      "@@ -1,1 +1,1 @@",
      "diff --git a/tests/test_foo.py b/tests/test_foo.py",
    ].join("\n");

    expect(extractPatchFilePaths(patch)).toEqual(["src/foo.py", "tests/test_foo.py"]);
  });

  it("builds expected phrases from patch + tests", () => {
    const task = normalizeSweBenchLiteRow({
      repo: "org/repo",
      instance_id: "repo__2",
      base_commit: "abc123",
      patch: [
        "diff --git a/src/serializer.py b/src/serializer.py",
        "diff --git a/tests/test_serializer.py b/tests/test_serializer.py",
      ].join("\n"),
      test_patch: "",
      problem_statement: "Serializer should support tuples",
      hints_text: "",
      FAIL_TO_PASS: '["tests/test_serializer.py::test_tuple_roundtrip"]',
      PASS_TO_PASS: "[]",
    });

    const expected = buildExpectedPhrases(task, 6);
    expect(expected).toContain("serializer");
    expect(expected).toContain("test_tuple_roundtrip");
  });

  it("builds query text + prompt", () => {
    const task = normalizeSweBenchLiteRow({
      repo: "org/repo",
      instance_id: "repo__3",
      base_commit: "abc123",
      patch: "",
      test_patch: "",
      problem_statement: "Fix handling for empty strings",
      hints_text: "Focus on parser state transitions.",
      FAIL_TO_PASS: "[]",
      PASS_TO_PASS: "[]",
    });

    const query = buildQueryText(task, 120);
    const prompt = buildTaskPrompt(task);

    expect(query).toContain("repo: org/repo");
    expect(prompt).toContain("SWE-bench Lite task: repo__3");
    expect(prompt).toContain("Problem statement:");
  });
});
