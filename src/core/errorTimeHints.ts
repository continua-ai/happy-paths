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
  // --- env_dep: command not found (most common real-world trap) ---
  {
    hintId: "err-pytest-not-found",
    family: "env_dep",
    pattern: /(?:command not found|No such file).*pytest|pytest.*command not found/i,
    explanation:
      "pytest is not on PATH. This repo needs a virtual environment — " +
      "check for requirements-dev.txt or pyproject.toml [project.optional-dependencies].",
    fixCommand: "create a venv, install dev deps, then retry",
    confidence: 0.95,
  },

  // --- env_dep: externally-managed-environment (PEP 668) ---
  {
    hintId: "err-externally-managed-env",
    family: "env_dep",
    pattern: /externally-managed-environment/i,
    explanation:
      "System Python is externally managed (PEP 668) — pip install won't work here. " +
      "Use a virtual environment instead.",
    fixCommand: "create a venv first, then pip install inside it",
    confidence: 0.95,
  },

  // --- env_dep: missing pytest-cov ---
  {
    hintId: "err-missing-pytest-cov-unrecognized",
    family: "env_dep",
    pattern: /unrecognized arguments?.*--cov/i,
    explanation:
      "pytest-cov plugin is missing. pyproject.toml configures --cov in addopts " +
      "so pytest fails before running any tests.",
    fixCommand: "pip install pytest-cov",
    confidence: 0.95,
  },
  {
    hintId: "err-missing-pytest-cov-module",
    family: "env_dep",
    pattern: /(?:ModuleNotFoundError|ImportError).*(?:pytest_cov|pytest\.cov)/i,
    explanation:
      "pytest-cov plugin is missing. The test config requires it for coverage.",
    fixCommand: "pip install pytest-cov",
    confidence: 0.95,
  },

  // --- env_dep: missing PyYAML ---
  {
    hintId: "err-missing-pyyaml",
    family: "env_dep",
    pattern: /(?:ModuleNotFoundError|ImportError).*No module named.*['"]yaml['"]/i,
    explanation: "The yaml module is PyYAML on PyPI (not 'yaml').",
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
      "This project's own package isn't on sys.path. " +
      "It likely needs an editable install so tests can import it.",
    fixCommand: "pip install -e .",
    confidence: 0.9,
  },

  // --- config: missing config.yaml ---
  {
    hintId: "err-missing-config-yaml",
    family: "config",
    pattern: /FileNotFoundError.*config\.yaml/i,
    explanation:
      "config.yaml is missing. Look for a config.yaml.example or similar template in the repo.",
    fixCommand: "cp config.yaml.example config.yaml",
    confidence: 0.9,
  },

  // --- config: missing SECRET_KEY ---
  {
    hintId: "err-missing-secret-key",
    family: "config",
    pattern: /KeyError.*['"]SECRET_KEY['"]/i,
    explanation:
      "SECRET_KEY env var is required. Check for a .env.example or config docs.",
    fixCommand: "export SECRET_KEY=<any-value-for-dev>",
    confidence: 0.85,
  },

  // --- tool_flag: broad pytest catching slow tests ---
  {
    hintId: "err-broad-pytest-slow",
    family: "tool_flag",
    pattern:
      /(?:FAILED|ERROR).*test_(?:integration|slow|heavy)|(?:time\.sleep|Timeout).*(?:30|60)\s*(?:sec|s\b)/i,
    explanation:
      "Slow/integration tests ran. Consider scoping to just the relevant test file " +
      "or using -k / -m to skip slow markers.",
    fixCommand: "pytest -k 'not slow and not integration' <test_file>",
    confidence: 0.7,
  },

  // --- Generic: missing Python dependency ---
  {
    hintId: "err-generic-missing-module",
    family: "env_dep",
    pattern: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
    explanation:
      "A Python module is missing. Check requirements.txt or requirements-dev.txt.",
    fixCommand: "pip install -r requirements-dev.txt",
    confidence: 0.6,
  },
];
