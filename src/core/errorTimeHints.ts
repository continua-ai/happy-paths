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
  // --- env_dep: missing pytest-cov ---
  {
    hintId: "err-missing-pytest-cov-unrecognized",
    family: "env_dep",
    pattern: /unrecognized arguments?.*--cov/i,
    explanation:
      "pytest-cov is not installed, but pyproject.toml configures --cov in addopts. " +
      "This causes pytest to fail before running any tests.",
    fixCommand: "pip install pytest-cov",
    confidence: 0.95,
  },
  {
    hintId: "err-missing-pytest-cov-module",
    family: "env_dep",
    pattern: /(?:ModuleNotFoundError|ImportError).*(?:pytest_cov|pytest\.cov)/i,
    explanation:
      "pytest-cov is not installed. The test configuration requires it for coverage reporting.",
    fixCommand: "pip install pytest-cov",
    confidence: 0.95,
  },

  // --- env_dep: missing PyYAML ---
  {
    hintId: "err-missing-pyyaml",
    family: "env_dep",
    pattern: /(?:ModuleNotFoundError|ImportError).*No module named.*['"]yaml['"]/i,
    explanation:
      "PyYAML is not installed. The code imports yaml but it's not in requirements.txt.",
    fixCommand: "pip install pyyaml",
    confidence: 0.95,
  },

  // --- env_dep: package not installed (editable mode) ---
  {
    hintId: "err-package-not-installed",
    family: "env_dep",
    pattern:
      /(?:ModuleNotFoundError|ImportError).*No module named.*['"](?:pymath|dataproc|taskapi)['"]/i,
    explanation:
      "The package is not installed. Tests import it but it's not on sys.path. " +
      "Install in editable/dev mode so tests can find it.",
    fixCommand: "pip install -e .",
    confidence: 0.9,
  },

  // --- config: missing config.yaml ---
  {
    hintId: "err-missing-config-yaml",
    family: "config",
    pattern: /FileNotFoundError.*config\.yaml/i,
    explanation:
      "config.yaml doesn't exist. The repo has config.yaml.example — copy it.",
    fixCommand: "cp config.yaml.example config.yaml",
    confidence: 0.9,
  },

  // --- config: missing SECRET_KEY ---
  {
    hintId: "err-missing-secret-key",
    family: "config",
    pattern: /KeyError.*['"]SECRET_KEY['"]/i,
    explanation:
      "The SECRET_KEY environment variable is not set. It's required by the app configuration.",
    fixCommand: "export SECRET_KEY=test-secret-key-for-dev",
    confidence: 0.85,
  },

  // --- tool_flag: broad pytest catching slow tests ---
  // This one is trickier — it fires when pytest output shows slow/integration test failures.
  // Lower confidence because the match is less specific.
  {
    hintId: "err-broad-pytest-slow",
    family: "tool_flag",
    pattern:
      /(?:FAILED|ERROR).*test_(?:integration|slow|heavy)|(?:time\.sleep|Timeout).*(?:30|60)\s*(?:sec|s\b)/i,
    explanation:
      "You may have run the full test suite including slow integration tests. " +
      "Scope your test run to the specific test file or use -k to filter.",
    fixCommand: "pytest -k 'not slow and not integration' tests/",
    confidence: 0.7,
  },

  // --- Generic: missing Python dependency ---
  // Catch-all for any ModuleNotFoundError (lower confidence than specific ones).
  {
    hintId: "err-generic-missing-module",
    family: "env_dep",
    pattern: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
    explanation:
      "A Python module is not installed. Check requirements.txt and requirements-dev.txt, " +
      "then install the missing dependency.",
    fixCommand: "pip install <module> (or pip install -r requirements-dev.txt)",
    confidence: 0.6,
  },
];
