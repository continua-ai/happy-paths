import { describe, expect, it } from "vitest";

import {
  DEFAULT_PATTERNS,
  HardWiredErrorTimeMatcher,
  formatErrorTimeHint,
} from "../src/core/errorTimeHints.js";

describe("HardWiredErrorTimeMatcher", () => {
  const matcher = new HardWiredErrorTimeMatcher();

  describe("missing-pytest-cov", () => {
    it("matches unrecognized --cov argument", () => {
      const error =
        "ERROR: usage: pytest [options] [file_or_dir]\n" +
        "pytest: error: unrecognized arguments: --cov=pymath --cov-report=term-missing";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-pytest-cov-unrecognized");
      expect(hint?.family).toBe("env_dep");
      expect(hint?.fixCommand).toBe("pip install pytest-cov");
      expect(hint?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("matches ModuleNotFoundError for pytest_cov", () => {
      const error = "ModuleNotFoundError: No module named 'pytest_cov'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-pytest-cov-module");
      expect(hint?.fixCommand).toBe("pip install pytest-cov");
    });
  });

  describe("missing-pyyaml", () => {
    it("matches ModuleNotFoundError for yaml", () => {
      const error = "ModuleNotFoundError: No module named 'yaml'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-pyyaml");
      expect(hint?.fixCommand).toBe("pip install pyyaml");
    });
  });

  describe("package-not-installed", () => {
    it("matches pymath import error", () => {
      const error = "ModuleNotFoundError: No module named 'pymath'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-package-not-installed");
      expect(hint?.fixCommand).toBe("pip install -e .");
    });

    it("matches dataproc import error", () => {
      const error = "ImportError: No module named 'dataproc'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-package-not-installed");
    });
  });

  describe("missing-config-yaml", () => {
    it("matches FileNotFoundError for config.yaml", () => {
      const error =
        "FileNotFoundError: [Errno 2] No such file or directory: 'config.yaml'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-config-yaml");
      expect(hint?.fixCommand).toBe("cp config.yaml.example config.yaml");
    });
  });

  describe("missing-secret-key", () => {
    it("matches KeyError for SECRET_KEY", () => {
      const error = "KeyError: 'SECRET_KEY'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-missing-secret-key");
      expect(hint?.fixCommand).toContain("SECRET_KEY");
    });
  });

  describe("broad-pytest-slow", () => {
    it("matches slow integration test failures", () => {
      const error =
        "FAILED tests/test_integration.py::test_heavy_computation - assert True";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-broad-pytest-slow");
      expect(hint?.family).toBe("tool_flag");
    });
  });

  describe("generic-missing-module", () => {
    it("matches any ModuleNotFoundError", () => {
      const error = "ModuleNotFoundError: No module named 'obscure_library'";
      const hint = matcher.match(error);
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-generic-missing-module");
      expect(hint?.confidence).toBeLessThan(0.7);
    });
  });

  describe("no match", () => {
    it("returns null for non-error text", () => {
      expect(matcher.match("all tests passed")).toBeNull();
    });

    it("returns null for empty text", () => {
      expect(matcher.match("")).toBeNull();
    });

    it("returns null for unrelated error", () => {
      expect(matcher.match("TypeError: cannot add int and str")).toBeNull();
    });
  });

  describe("priority (highest confidence wins)", () => {
    it("prefers specific match over generic", () => {
      // "No module named 'pymath'" matches both err-package-not-installed
      // (confidence 0.9) and err-generic-missing-module (confidence 0.6).
      const error = "ModuleNotFoundError: No module named 'pymath'";
      const hint = matcher.match(error);
      expect(hint?.hintId).toBe("err-package-not-installed");
    });
  });
});

describe("formatErrorTimeHint", () => {
  it("formats a hint with explanation and fix command", () => {
    const formatted = formatErrorTimeHint({
      hintId: "err-missing-pytest-cov-unrecognized",
      family: "env_dep",
      matchedPattern: "unrecognized arguments.*--cov",
      matchedText: "unrecognized arguments: --cov=pymath",
      explanation: "pytest-cov is not installed.",
      fixCommand: "pip install pytest-cov",
      confidence: 0.95,
    });

    expect(formatted).toContain("Happy Paths hint");
    expect(formatted).toContain("pytest-cov is not installed.");
    expect(formatted).toContain("pip install pytest-cov");
  });
});

describe("DEFAULT_PATTERNS", () => {
  it("has at least 7 patterns", () => {
    expect(DEFAULT_PATTERNS.length).toBeGreaterThanOrEqual(7);
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
