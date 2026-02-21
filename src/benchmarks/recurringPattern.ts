/**
 * Recurring-pattern benchmark for Happy Paths.
 *
 * Unlike SWE-bench Lite (where tasks are unrelated bugs in the same repo),
 * this benchmark has tasks that intentionally share failure modes across
 * different repos and bug types. The core test: can learning from task 1's
 * wrong turns help task 5 avoid the same trap?
 *
 * Error families:
 * - env_dep: missing dev dependencies (e.g., `ModuleNotFoundError`)
 * - tool_flag: running tools with wrong flags (e.g., `pytest` without `-k`)
 * - config: missing config or env vars (e.g., `KeyError: 'SECRET_KEY'`)
 * - test_scope: tests that need scoping to avoid timeout/noise
 */

/** A recurring error pattern that appears across multiple tasks. */
export interface RecurringTrap {
  /** Stable identifier for this trap (e.g., "missing-pytest-cov"). */
  trapId: string;

  /** Which error family this belongs to. */
  family: "env_dep" | "tool_flag" | "config" | "test_scope";

  /** Human-readable description. */
  description: string;

  /**
   * Regex pattern that matches the error output an agent will see.
   * Used to verify the trap fires and for error-signature matching.
   */
  errorPattern: string;

  /** The fix an agent should apply (human-readable). */
  fixDescription: string;

  /** The exact command or action that fixes this trap. */
  fixCommand: string;
}

/** A single benchmark task. */
export interface RecurringPatternTask {
  /** Stable task ID (e.g., "pymath-001-mean-empty-list"). */
  taskId: string;

  /** Which repo template this task uses. */
  repoTemplateId: string;

  /** The bug the agent must fix (shown as the task prompt). */
  bugDescription: string;

  /** Detailed problem statement for the agent. */
  problemStatement: string;

  /** Which traps (by trapId) this task is expected to trigger. */
  expectedTrapIds: string[];

  /** Command to verify the fix (e.g., "pytest tests/test_stats.py::test_mean_empty"). */
  verifyCommand: string;

  /** Expected verify command exit code on success (default: 0). */
  verifyExitCode?: number;

  /**
   * Gold-standard patch: file path → content after fix.
   * Used for automated verification (not shown to agent).
   */
  goldPatch: Record<string, string>;
}

/** A repo template that the benchmark generator creates. */
export interface RepoTemplate {
  /** Stable template ID (e.g., "pymath"). */
  templateId: string;

  /** Human-readable name. */
  name: string;

  /** Description of the repo. */
  description: string;

  /** Language/ecosystem. */
  language: "python" | "typescript" | "go";

  /** Files to create: relative path → content. */
  files: Record<string, string>;

  /** Commands to run after creating files (before git init). */
  setupCommands: string[];

  /** Traps embedded in this repo. */
  traps: RecurringTrap[];
}

/** The full benchmark pack (serializable). */
export interface RecurringPatternBenchmarkPack {
  schemaVersion: 1;
  generatedAtUtc: string;
  description: string;
  templates: RepoTemplate[];
  tasks: RecurringPatternTask[];
  trapIndex: Record<string, RecurringTrap>;
}

/** Session identity for recurring-pattern benchmark runs. */
export interface RecurringPatternSessionIdentity {
  sessionId: string;
  prefix: string;
  taskId: string;
  variant: "off" | "on";
  replicate: string;
}

/**
 * Parse a recurring-pattern session ID.
 *
 * Format: `rp::<taskId>::<variant>::<replicate>`
 */
export function parseRecurringPatternSessionId(
  sessionId: string,
  prefix = "rp",
): RecurringPatternSessionIdentity | null {
  const parts = sessionId.split("::");

  if (parts.length !== 3 && parts.length !== 4) {
    return null;
  }

  if (parts[0] !== prefix) {
    return null;
  }

  const taskId = parts[1]?.trim() ?? "";
  const variant = parts[2]?.trim();
  const replicate = (parts[3]?.trim() || "r1").toLowerCase();

  if (!taskId || (variant !== "off" && variant !== "on") || !replicate) {
    return null;
  }

  return { sessionId, prefix, taskId, variant, replicate };
}

/**
 * Build a task prompt for the agent.
 *
 * Includes the problem statement, repo context, and verification command.
 * Does NOT include trap information (the agent discovers those naturally).
 */
export function buildRecurringPatternPrompt(task: RecurringPatternTask): string {
  return [
    `Task: ${task.taskId}`,
    `Repository: ${task.repoTemplateId}`,
    "",
    "Problem:",
    task.problemStatement.trim(),
    "",
    "Verification:",
    `Run \`${task.verifyCommand}\` — it should pass after your fix.`,
    "",
    "Instructions:",
    "- Fix the bug described above.",
    "- Do not change the test files.",
    "- Run the verification command to confirm your fix works.",
  ].join("\n");
}

/** Count how many tasks share each trap. */
export function trapRecurrenceCounts(
  tasks: RecurringPatternTask[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const trapId of task.expectedTrapIds) {
      counts.set(trapId, (counts.get(trapId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Group tasks by their expected traps for analysis.
 * Returns a map: trapId → taskIds that share it.
 */
export function tasksByTrap(tasks: RecurringPatternTask[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const task of tasks) {
    for (const trapId of task.expectedTrapIds) {
      const existing = result.get(trapId) ?? [];
      existing.push(task.taskId);
      result.set(trapId, existing);
    }
  }
  return result;
}
