/**
 * Tool-call proactive hints for "reinvention" patterns.
 *
 * Detects when an agent writes throwaway inline scripts for operations
 * that have existing repo tools. Appends a hint to the tool_result
 * suggesting the existing tool.
 *
 * This is complementary to error-time hints (which fire on errors).
 * Tool-call hints fire on SUCCESSFUL operations that were done the
 * hard way — the agent succeeded, but wasted tokens doing it.
 *
 * Architecture:
 * - On tool_call: detect bash heredoc patterns that match "reinvention" signatures
 * - Flag the tool call for hint injection
 * - On tool_result for that flagged call: append the hint
 *
 * Mined from 300 real Pi sessions:
 * - 1,632 throwaway Linear API scripts (~579K tokens)
 * - 2,264 throwaway GCloud scripts (~697K tokens)
 * - 775 JSON processing heredocs that could use jq (~72K tokens)
 */

/** A proactive hint about a better alternative to the current approach. */
export interface ToolCallHint {
  /** Stable ID for dedup and analysis. */
  hintId: string;

  /** What the agent is doing. */
  detectedPattern: string;

  /** What the agent SHOULD use instead. */
  betterAlternative: string;

  /** Example command for the better alternative. */
  exampleCommand: string;

  /** Confidence (0–1). */
  confidence: number;
}

/** Patterns to match against bash command input. */
interface ReinventionPattern {
  hintId: string;
  /** Regex to match against the bash command. */
  commandPattern: RegExp;
  /** Minimum line count to trigger (avoids false positives on small scripts). */
  minLines: number;
  detectedPattern: string;
  betterAlternative: string;
  exampleCommand: string;
  confidence: number;
}

const REINVENTION_PATTERNS: ReinventionPattern[] = [
  // Linear API mutation — MUST come before query (mutation scripts also contain "query")
  {
    hintId: "reinvent-linear-mutation",
    commandPattern:
      /python3?\s+(-\s+)?<<[\s\S]*?(?:linear\.app|LINEAR_API)[\s\S]*?(?:mutation|commentCreate|issueUpdate|issueCreate|documentCreate)/i,
    minLines: 15,
    detectedPattern: "Inline Linear API mutation script",
    betterAlternative:
      "Consider extending `scripts/linear_consolidation.py` with this operation, " +
      "or saving the script to /tmp/ so it can be reused.",
    exampleCommand:
      "Write to /tmp/linear_update.py and run it, or extend linear_consolidation.py",
    confidence: 0.85,
  },

  // Linear API query heredoc
  {
    hintId: "reinvent-linear-query",
    commandPattern:
      /python3?\s+(-\s+)?<<[\s\S]*?(?:linear\.app|LINEAR_API)[\s\S]*?(?:query\b|issue\(|issues\()/i,
    minLines: 15,
    detectedPattern: "Inline Linear API query script",
    betterAlternative:
      "This repo has `scripts/linear_consolidation.py` with dump and search commands.",
    exampleCommand:
      "pants run scripts:linear_consolidation -- dump --key CON-1234 --out /tmp/issue.md",
    confidence: 0.9,
  },

  // GCloud logging heredoc
  {
    hintId: "reinvent-gcloud-logging",
    commandPattern:
      /python3?\s+(-\s+)?<<[\s\S]*?(?:gcloud.*logging|cloud_logging|CloudLogging)/i,
    minLines: 10,
    detectedPattern: "Inline GCloud logging query script",
    betterAlternative:
      "This repo has `sophon/scripts/triage_prod_logs.py` for log queries.",
    exampleCommand:
      "pants run sophon/scripts:triage_prod_logs -- --env prod --since-hours 6",
    confidence: 0.85,
  },

  // GCloud deploy status heredoc
  {
    hintId: "reinvent-gcloud-deploy",
    commandPattern:
      /python3?\s+(-\s+)?<<[\s\S]*?(?:cloud_run|gcloud.*run|terraform.*apply|deploy.*status)/i,
    minLines: 10,
    detectedPattern: "Inline deploy/infra status script",
    betterAlternative: "This repo has `./dx deploy` subcommands for deploy status.",
    exampleCommand: "./dx deploy watch --service sophon --env staging",
    confidence: 0.8,
  },

  // JSON processing that should use jq
  {
    hintId: "reinvent-json-jq",
    commandPattern: /python3?\s+(-\s+)?<<[\s\S]*?json\.load\(open\(.*\)\).*\n.*print/i,
    minLines: 3,
    detectedPattern: "Inline JSON extraction script",
    betterAlternative:
      "For simple JSON field extraction, prefer `jq` — it's faster and doesn't need a heredoc.",
    exampleCommand: "jq '.field.subfield' /path/to/file.json",
    confidence: 0.7,
  },

  // Subprocess wrapper (python wrapping a shell command)
  {
    hintId: "reinvent-subprocess-wrapper",
    commandPattern: /python3?\s+(-\s+)?<<[\s\S]*?subprocess\.run\(.*\n.*json\.loads/i,
    minLines: 10,
    detectedPattern: "Python subprocess wrapper just to parse JSON output",
    betterAlternative:
      "Run the shell command directly and pipe to `jq` instead of wrapping in Python subprocess.",
    exampleCommand: "command-that-outputs-json | jq '.field'",
    confidence: 0.7,
  },
];

/**
 * Check if a bash command matches a reinvention pattern.
 * Returns the hint to inject, or null.
 */
export function matchToolCallReinvention(bashCommand: string): ToolCallHint | null {
  if (!bashCommand || bashCommand.length < 50) {
    return null;
  }

  const lineCount = bashCommand.split("\n").length;

  for (const pattern of REINVENTION_PATTERNS) {
    if (lineCount < pattern.minLines) {
      continue;
    }
    if (!pattern.commandPattern.test(bashCommand)) {
      continue;
    }
    return {
      hintId: pattern.hintId,
      detectedPattern: pattern.detectedPattern,
      betterAlternative: pattern.betterAlternative,
      exampleCommand: pattern.exampleCommand,
      confidence: pattern.confidence,
    };
  }

  return null;
}

/**
 * Format a tool-call hint for injection into tool_result content.
 */
export function formatToolCallHint(hint: ToolCallHint): string {
  return [
    "",
    "─── Happy Paths tip (reusable tool available) ───",
    `${hint.betterAlternative}`,
    `Example: ${hint.exampleCommand}`,
    "──────────────────────────────────────────────────",
  ].join("\n");
}
