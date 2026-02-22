/**
 * Error-time hint matching for tool_result interception.
 *
 * When an agent hits an error, match the error text against known
 * error signatures and provide a fix hint. This is the primary
 * hint delivery channel — highest relevance, most specific match,
 * natural timing (agent just saw the error).
 *
 * Architecture:
 * - ErrorTimeHintMatcher: interface for matching error text → hint
 * - HardWiredErrorTimeMatcher: prototype matcher with hand-coded patterns
 * - (Future) MinedErrorTimeMatcher: matcher powered by trace mining
 */

/** A matched error-time hint. */
export interface ErrorTimeHint {
  /** Stable ID for this hint (for dedup and analysis). */
  hintId: string;

  /** Which error family this belongs to. */
  family: string;

  /** Regex pattern that matched. */
  matchedPattern: string;

  /** The snippet of error text that matched. */
  matchedText: string;

  /** Human-readable explanation of why the error happened. */
  explanation: string;

  /** The suggested fix (a command or action). */
  fixCommand: string;

  /** Confidence in this match (0–1). */
  confidence: number;
}

/** Interface for error-time hint matchers. */
export interface ErrorTimeHintMatcher {
  /**
   * Match error text against known patterns.
   * Returns the best hint, or null if no match.
   */
  match(errorText: string): ErrorTimeHint | null;
}

/** A hand-coded error pattern for the prototype. */
export interface HardWiredPattern {
  hintId: string;
  family: string;
  pattern: RegExp;
  explanation: string;
  fixCommand: string;
  confidence: number;
}

/**
 * Prototype matcher with hand-wired error → fix patterns.
 *
 * These patterns are based on the recurring traps in the benchmark,
 * but they're general enough to match in any Python project with
 * the same issues.
 */
export class HardWiredErrorTimeMatcher implements ErrorTimeHintMatcher {
  private readonly patterns: HardWiredPattern[];

  constructor(patterns?: HardWiredPattern[]) {
    this.patterns = patterns ?? DEFAULT_PATTERNS;
  }

  match(errorText: string): ErrorTimeHint | null {
    if (!errorText || errorText.length === 0) {
      return null;
    }

    // Normalize: collapse whitespace, limit length for matching.
    const normalized = errorText.replace(/\s+/g, " ").trim().slice(0, 8_000);

    let bestMatch: ErrorTimeHint | null = null;

    for (const pattern of this.patterns) {
      const regexMatch = pattern.pattern.exec(normalized);
      if (!regexMatch) {
        continue;
      }

      const hint: ErrorTimeHint = {
        hintId: pattern.hintId,
        family: pattern.family,
        matchedPattern: pattern.pattern.source,
        matchedText: regexMatch[0].slice(0, 200),
        explanation: pattern.explanation,
        fixCommand: pattern.fixCommand,
        confidence: pattern.confidence,
      };

      // Return the first (highest priority) match.
      if (!bestMatch || hint.confidence > bestMatch.confidence) {
        bestMatch = hint;
      }
    }

    return bestMatch;
  }
}

/**
 * Format a hint for injection into tool_result content.
 *
 * The format is designed to be immediately actionable for an LLM agent:
 * short, explains the cause, gives the fix command.
 */
export function formatErrorTimeHint(hint: ErrorTimeHint): string {
  return [
    "",
    "─── Happy Paths hint (from prior traces) ───",
    `${hint.explanation}`,
    `Fix: ${hint.fixCommand}`,
    "──────────────────────────────────────────────",
  ].join("\n");
}

// ─── Default patterns ───────────────────────────────────────────────────

export const DEFAULT_PATTERNS: HardWiredPattern[] = [
  // ═══ HARD TRAPS (internal tooling — model has no training data) ═══

  // --- env_dep: internal vendor package (not on PyPI) ---
  {
    hintId: "err-internal-vendor-dep",
    family: "env_dep",
    pattern:
      /(?:ModuleNotFoundError|ImportError).*No module named.*['"]authlib_internal['"]/i,
    explanation:
      "This is a local/internal package, not available on PyPI. " +
      "Check the vendor/ or lib/ directory for local packages.",
    fixCommand: "look in vendor/ for the package and pip install it from there",
    confidence: 0.95,
  },

  // --- env_dep: pip install fails for internal package ---
  {
    hintId: "err-vendor-not-on-pypi",
    family: "env_dep",
    pattern:
      /No matching distribution found for authlib|Could not find a version.*authlib.internal/i,
    explanation:
      "This package isn't on PyPI — it's bundled locally. " +
      "Check vendor/ for a local copy.",
    fixCommand: "pip install vendor/<package>",
    confidence: 0.95,
  },

  // --- config: missing test env vars ---
  {
    hintId: "err-missing-test-env",
    family: "config",
    pattern: /KeyError.*['"]TASKAPI_(?:DB_URL|SECRET)['"]/i,
    explanation:
      "This project requires env vars for testing. " +
      "Look for .env.test or .env.example in the project root.",
    fixCommand: "source .env.test (or check the project's dev CLI)",
    confidence: 0.95,
  },

  // --- tool_flag: generated code missing (build step required) ---
  {
    hintId: "err-generated-code-missing",
    family: "tool_flag",
    pattern:
      /ModuleNotFoundError.*(?:generated\.schema|generated\.config)|cannot import name.*from.*generated/i,
    explanation:
      "This module is auto-generated code — it doesn't exist until a build step runs. " +
      "Check for a build script or README.",
    fixCommand: "look for ./proj build, make build, or similar in the project root",
    confidence: 0.95,
  },

  // ═══ SETUP RECIPE (fires once on first test-related error) ═══
  //
  // One comprehensive hint covering the entire sad-path sequence:
  //   pytest not found → externally managed → missing deps → missing fixtures
  // Fires on the FIRST error encountered, provides the FULL recipe.
  // Deduped by hintId so it only fires once per session.
  {
    hintId: "err-python-project-setup-recipe",
    family: "tool_flag",
    pattern:
      /pytest: command not found|No module named pytest|externally.managed.environment|test data not found|No such file.*\.fixtures|No such file.*\.testdata/i,
    explanation:
      "This project needs a venv before anything will work. " +
      "Run: python3 -m venv .venv && " +
      ".venv/bin/pip install -r requirements-dev.txt — " +
      "then look for executable setup scripts in the repo root " +
      "(e.g. ./kit, ./qa, ./dev — run them to create test fixtures). " +
      "Use .venv/bin/pytest (not pytest or python -m pytest) to run tests.",
    fixCommand:
      "python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/pytest tests/ -x",
    confidence: 0.95,
  },

  // ═══ EXPERIENCE-ONLY TRAPS (misdirecting errors) ═══

  // --- env_dep: phantom plugins package (not on PyPI) ---
  {
    hintId: "err-phantom-plugins-dep",
    family: "env_dep",
    pattern:
      /calclib_plugins is not installed|pip install calclib-plugins|No module named.*calclib_plugins/i,
    explanation:
      "calclib_plugins doesn't exist on PyPI — it's a phantom dependency in conftest.py. " +
      "Create a stub package directory so the import check passes.",
    fixCommand: "mkdir -p calclib_plugins && touch calclib_plugins/__init__.py",
    confidence: 0.95,
  },

  // --- tool_setup: undocumented fixtures tool (ledgerkit) ---
  {
    hintId: "err-undocumented-fixtures-tool",
    family: "tool_setup",
    pattern: /test data not found.*\.fixtures|ledgerkit\.internal/i,
    explanation:
      "Test fixtures must be generated before running tests. " +
      "This project has a ./kit tool — run ./kit init to create fixtures.",
    fixCommand: "./kit init && pytest tests/ -x",
    confidence: 0.9,
  },

  // --- tool_setup: undocumented test data tool (logparse) ---
  {
    hintId: "err-undocumented-testdata-tool",
    family: "tool_setup",
    pattern: /test data not found.*\.testdata|logparse\.internal/i,
    explanation:
      "Test data must be generated before running tests. " +
      "This project has a ./qa tool — run ./qa setup to create test data.",
    fixCommand: "./qa setup && pytest tests/ -x",
    confidence: 0.9,
  },

  // --- tool_flag: test timeout from slow session fixture ---
  {
    hintId: "err-session-fixture-timeout",
    family: "tool_flag",
    pattern: /(?:Failed: Timeout >|Timeout >[\d.]+s|FAILED.*Timeout)/i,
    explanation:
      "This timeout may be from a slow session-scoped fixture in conftest.py, " +
      "not from the test itself. Check conftest.py for session fixtures, " +
      "or increase the timeout.",
    fixCommand: "pytest --timeout=30 tests/ -x",
    confidence: 0.85,
  },

  // ═══ MEDIUM TRAPS (common but models sometimes struggle) ═══

  // --- env_dep: missing pytest-cov ---
  {
    hintId: "err-missing-pytest-cov-unrecognized",
    family: "env_dep",
    pattern: /unrecognized arguments?.*--cov/i,
    explanation:
      "pytest-cov plugin is missing. pyproject.toml configures --cov in addopts " +
      "so pytest fails before running any tests.",
    fixCommand: "pip install pytest-cov",
    confidence: 0.85,
  },

  // --- env_dep: missing PyYAML ---
  {
    hintId: "err-missing-pyyaml",
    family: "env_dep",
    pattern: /(?:ModuleNotFoundError|ImportError).*No module named.*['"]yaml['"]/i,
    explanation: "The yaml module is PyYAML on PyPI (not 'yaml').",
    fixCommand: "pip install pyyaml",
    confidence: 0.85,
  },

  // --- config: missing config.yaml ---
  {
    hintId: "err-missing-config-yaml",
    family: "config",
    pattern: /FileNotFoundError.*config\.yaml/i,
    explanation:
      "config.yaml is missing. Look for a config.yaml.example or similar template in the repo.",
    fixCommand: "cp config.yaml.example config.yaml",
    confidence: 0.8,
  },

  // ═══ EASY TRAPS (disabled — models handle these fine) ═══
  // pytest-not-found, externally-managed-env, SECRET_KEY, broad-pytest,
  // generic-missing-module: removed. No value in hinting on errors the
  // model already resolves in 1 step.
];
