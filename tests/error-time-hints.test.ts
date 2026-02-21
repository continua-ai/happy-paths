import { describe, expect, it } from "vitest";

import {
  DEFAULT_PATTERNS,
  HardWiredErrorTimeMatcher,
  formatErrorTimeHint,
} from "../src/core/errorTimeHints.js";

describe("HardWiredErrorTimeMatcher", () => {
  const matcher = new HardWiredErrorTimeMatcher();

  describe("hard traps — internal vendor dep", () => {
    it("matches ModuleNotFoundError for authlib_internal", () => {
      const error = "ModuleNotFoundError: No module named 'authlib_internal'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-internal-vendor-dep");
      expect(hint?.family).toBe("env_dep");
      expect(hint?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("matches pip failure for authlib-internal", () => {
      const error =
        "ERROR: No matching distribution found for authlib-internal";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-vendor-not-on-pypi");
    });
  });

  describe("hard traps — missing test env", () => {
    it("matches KeyError for TASKAPI_DB_URL", () => {
      const error = "KeyError: 'TASKAPI_DB_URL'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-test-env");
      expect(hint?.family).toBe("config");
    });

    it("matches KeyError for TASKAPI_SECRET", () => {
      const error = "KeyError: 'TASKAPI_SECRET'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-test-env");
    });
  });

  describe("hard traps — generated code missing", () => {
    it("matches generated.schema import error", () => {
      const error =
        "ModuleNotFoundError: No module named 'buildkit.generated.schema'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-generated-code-missing");
      expect(hint?.family).toBe("tool_flag");
    });
  });

  describe("medium traps", () => {
    it("matches missing pytest-cov", () => {
      const error =
        "pytest: error: unrecognized arguments: --cov=pymath --cov-report=term-missing";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-pytest-cov-unrecognized");
    });

    it("matches missing pyyaml", () => {
      const error = "ModuleNotFoundError: No module named 'yaml'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-pyyaml");
    });

    it("matches missing config.yaml", () => {
      const error =
        "FileNotFoundError: [Errno 2] No such file or directory: 'config.yaml'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-config-yaml");
    });
  });

  describe("easy traps — NOT matched (models handle these)", () => {
    it("does not match pytest: command not found", () => {
      expect(
        matcher.match("/bin/bash: line 1: pytest: command not found"),
      ).toBeNull();
    });

    it("does not match externally-managed-environment", () => {
      expect(
        matcher.match("error: externally-managed-environment"),
      ).toBeNull();
    });

    it("does not match generic missing module", () => {
      expect(
        matcher.match("ModuleNotFoundError: No module named 'requests'"),
      ).toBeNull();
    });
  });

  describe("no match", () => {
    it("returns null for non-error text", () => {
      expect(matcher.match("all tests passed")).toBeNull();
    });

    it("returns null for empty text", () => {
      expect(matcher.match("")).toBeNull();
    });
  });
});

describe("formatErrorTimeHint", () => {
  it("formats a hint with explanation", () => {
    const formatted = formatErrorTimeHint({
      hintId: "err-internal-vendor-dep",
      family: "env_dep",
      matchedPattern: "No module named.*authlib_internal",
      matchedText: "No module named 'authlib_internal'",
      explanation: "This is a local/internal package.",
      fixCommand: "look in vendor/ for the package",
      confidence: 0.95,
    });

    expect(formatted).toContain("Happy Paths hint");
    expect(formatted).toContain("local/internal package");
  });
});

describe("DEFAULT_PATTERNS", () => {
  it("has hard-trap patterns", () => {
    const ids = DEFAULT_PATTERNS.map((p) => p.hintId);
    expect(ids).toContain("err-internal-vendor-dep");
    expect(ids).toContain("err-vendor-not-on-pypi");
    expect(ids).toContain("err-missing-test-env");
    expect(ids).toContain("err-generated-code-missing");
  });

  it("does NOT have easy-trap patterns", () => {
    const ids = DEFAULT_PATTERNS.map((p) => p.hintId);
    expect(ids).not.toContain("err-pytest-not-found");
    expect(ids).not.toContain("err-externally-managed-env");
    expect(ids).not.toContain("err-generic-missing-module");
  });

  it("every pattern has required fields", () => {
    for (const pattern of DEFAULT_PATTERNS) {
      expect(pattern.hintId).toBeTruthy();
      expect(pattern.family).toBeTruthy();
      expect(pattern.pattern).toBeInstanceOf(RegExp);
      expect(pattern.explanation.length).toBeGreaterThan(0);
      expect(pattern.fixCommand.length).toBeGreaterThan(0);
      expect(pattern.confidence).toBeGreaterThan(0);
      expect(pattern.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("hint IDs are unique", () => {
    const ids = DEFAULT_PATTERNS.map((p) => p.hintId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
