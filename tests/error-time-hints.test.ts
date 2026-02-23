import { describe, expect, it } from "vitest";

import {
  DEFAULT_PATTERNS,
  HardWiredErrorTimeMatcher,
  formatErrorTimeHint,
  scanRepoForDiscoverability,
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
      const error = "ERROR: No matching distribution found for authlib-internal";
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
      const error = "ModuleNotFoundError: No module named 'buildkit.generated.schema'";
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

  describe("setup recipe hint (fires once, covers full sad path)", () => {
    it("matches pytest: command not found", () => {
      const hint = matcher.match("/bin/bash: line 1: pytest: command not found");
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-python-project-setup-recipe");
      expect(hint?.explanation).toContain("python3 -m venv .venv");
      expect(hint?.explanation).toContain("executable setup scripts");
    });

    it("matches externally-managed-environment", () => {
      const hint = matcher.match("error: externally-managed-environment");
      expect(hint).not.toBeNull();
      expect(hint?.hintId).toBe("err-python-project-setup-recipe");
    });

    it("matches test data not found", () => {
      const hint = matcher.match(
        "Error: test data not found (.fixtures/testdata.json)",
      );
      expect(hint).not.toBeNull();
      // Could match setup recipe OR project-specific hint (setup recipe has priority)
      expect(hint?.hintId).toBe("err-python-project-setup-recipe");
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

  it("has setup recipe pattern for common sad paths", () => {
    const ids = DEFAULT_PATTERNS.map((p) => p.hintId);
    expect(ids).toContain("err-python-project-setup-recipe");
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

describe("discoverability gate", () => {
  it("suppresses specific tool hint when tool is documented in README", () => {
    // README documents ./kit AND general setup (venv + pip install + requirements)
    const readmeWithKit =
      "# MyProject\n\nRun ./kit init to set up fixtures.\npython -m venv .venv\npip install -r requirements-dev.txt\n";
    const matcher = new HardWiredErrorTimeMatcher({ repoDocsText: readmeWithKit });

    // Both the ./kit hint AND the setup recipe should be suppressed.
    const hint = matcher.match("test data not found in .fixtures directory");
    expect(hint).toBeNull();
  });

  it("fires hints when tool is NOT documented", () => {
    const readmeWithoutKit = "# MyProject\n\nA simple Python project.\n";
    const matcher = new HardWiredErrorTimeMatcher({ repoDocsText: readmeWithoutKit });

    // Both ./kit and setup recipe should fire (neither is documented).
    // Setup recipe fires first since it has higher confidence and matches the pattern.
    const hint = matcher.match("test data not found in .fixtures directory");
    expect(hint).not.toBeNull();
    // Either the setup recipe or the specific ./kit hint is fine — both help.
    expect([
      "err-python-project-setup-recipe",
      "err-undocumented-fixtures-tool",
    ]).toContain(hint?.hintId);
  });

  it("fires hints when no repoDocsText is provided", () => {
    const matcher = new HardWiredErrorTimeMatcher();

    // No docs → no suppression.
    const hint = matcher.match("test data not found in .fixtures directory");
    expect(hint).not.toBeNull();
  });

  it("suppresses git push hint when README documents --force-with-lease", () => {
    const readme =
      "# Git Workflow\n\nUse git push --force-with-lease after rebasing.\n";
    const matcher = new HardWiredErrorTimeMatcher({ repoDocsText: readme });

    const hint = matcher.match(
      "error: failed to push some refs. Updates were rejected",
    );
    expect(hint).toBeNull();
  });

  it("fires git push hint when README has no git guidance", () => {
    const readme = "# MyProject\n\nA Python utility library.\n";
    const matcher = new HardWiredErrorTimeMatcher({ repoDocsText: readme });

    const hint = matcher.match(
      "error: failed to push some refs. Updates were rejected",
    );
    expect(hint).not.toBeNull();
    expect(hint?.hintId).toBe("err-push-rejected-diverged");
  });

  it("suppresses fmt-before-lint when README documents fmt", () => {
    const readme = "# Build\n\nRun ./mb fmt before linting.\n";
    const matcher = new HardWiredErrorTimeMatcher({ repoDocsText: readme });

    const hint = matcher.match("FORMATTING CHECK FAILED: run format first");
    expect(hint).toBeNull();
  });

  it("scanRepoForDiscoverability lowercases for substring matching", () => {
    const text = scanRepoForDiscoverability(
      "Run ./kit init and pip install -r requirements.txt",
    );
    expect(text.includes("./kit")).toBe(true);
    expect(text.includes("pip install")).toBe(true);
    expect(text.includes("requirements.txt")).toBe(true);
  });
});
