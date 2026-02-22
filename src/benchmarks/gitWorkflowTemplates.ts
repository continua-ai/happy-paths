/**
 * Git-workflow benchmark templates.
 *
 * Tests the top 3 git sad paths from session mining (300 real Pi sessions):
 * 1. Push conflicts (244×): agent pushes to a branch that has diverged
 * 2. Dirty rebase (135×): agent tries to rebase with uncommitted changes
 *
 * (Worktree confusion (132×) requires multiple worktrees — deferred.)
 *
 * Each task uses the "gitflow" repo template: a small Python project with
 * a local bare "remote" and pre-staged git state.
 */

import type {
  RecurringPatternTask,
  RecurringTrap,
  RepoTemplate,
} from "./recurringPattern.js";

// ─── Shared Python files ────────────────────────────────────────────────

const GITFLOW_FILES: Record<string, string> = {
  "README.md": `# gitflow

A small Python utility library with CI and git workflow conventions.

## Development

\`\`\`bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
\`\`\`

## Git workflow

- Branch from \`main\`, push to \`origin/<branch>\`.
- Rebase onto \`main\` before merging.
- Use \`git push --force-with-lease\` after rebasing (never \`--force\`).
`,
  "setup.py": `from setuptools import setup, find_packages
setup(name="gitflow", version="0.1.0", packages=find_packages("src"), package_dir={"": "src"}, extras_require={"dev": ["pytest"]})
`,
  "src/gitflow/__init__.py": `"""gitflow: small utility library."""
`,
  "src/gitflow/utils.py": `"""Utility functions."""


def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}!"


def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def upper(s: str) -> str:
    """Uppercase a string."""
    return s.upper()
`,
  "tests/test_utils.py": `"""Tests for gitflow.utils."""
from gitflow import utils


def test_greet():
    assert utils.greet("World") == "Hello, World!"


def test_add():
    assert utils.add(2, 3) == 5


def test_upper():
    assert utils.upper("hello") == "HELLO"
`,
};

// ─── Traps ──────────────────────────────────────────────────────────────

const TRAP_PUSH_CONFLICT: RecurringTrap = {
  trapId: "push-conflict",
  family: "git_workflow",
  description:
    "Push fails because remote branch has diverged. Agent must fetch/rebase before pushing.",
  errorPattern: "rejected.*non-fast-forward|failed to push.*Updates were rejected",
  fixDescription:
    "Fetch and rebase onto the remote branch, then force-push with lease.",
  fixCommand:
    "git fetch origin && git rebase origin/<branch> && git push --force-with-lease",
};

const TRAP_DIRTY_REBASE: RecurringTrap = {
  trapId: "dirty-rebase",
  family: "git_workflow",
  description:
    "Rebase fails because working tree has uncommitted changes. Agent must stash or commit first.",
  errorPattern:
    "cannot rebase.*uncommitted changes|cannot pull with rebase.*unstaged changes",
  fixDescription: "Stash uncommitted changes, rebase, then pop the stash.",
  fixCommand: "git stash && git rebase origin/main && git stash pop",
};

// ─── Template ───────────────────────────────────────────────────────────

export const GITFLOW_TEMPLATE: RepoTemplate = {
  templateId: "gitflow",
  name: "gitflow",
  description:
    "Small Python project with local bare remote and pre-staged git conflicts. " +
    "Tests push-conflict and dirty-rebase recovery.",
  language: "python",
  files: GITFLOW_FILES,
  executablePaths: [],
  setupCommands: [],
  traps: [TRAP_PUSH_CONFLICT, TRAP_DIRTY_REBASE],
};

// ─── Tasks ──────────────────────────────────────────────────────────────

export const GIT_WORKFLOW_TASKS: RecurringPatternTask[] = [
  {
    taskId: "gitflow-push-after-diverge",
    repoTemplateId: "gitflow",
    bugDescription:
      "Change greet() to return 'Hi, {name}!' and push to origin/fix-greeting.",
    problemStatement: `Fix the \`greet()\` function in \`src/gitflow/utils.py\` to return \`"Hi, {name}!"\` instead of \`"Hello, {name}!"\`. Then commit your change and push it to \`origin/fix-greeting\`.

Note: you are on the \`fix-greeting\` branch. Push your changes to \`origin/fix-greeting\`.

Verify the fix works by running \`pytest tests/test_utils.py -k test_greet\` (update the test to match the new greeting).`,
    expectedTrapIds: ["push-conflict"],
    verifyCommand: "git log --oneline origin/fix-greeting | head -1",
    goldPatch: {
      "src/gitflow/utils.py": `"""Utility functions."""


def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hi, {name}!"


def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def upper(s: str) -> str:
    """Uppercase a string."""
    return s.upper()
`,
    },
  },
  {
    taskId: "gitflow-push-conflict-multiply",
    repoTemplateId: "gitflow",
    bugDescription: "Add multiply() function and push to origin/feature-multiply.",
    problemStatement: `Add a \`multiply()\` function to \`src/gitflow/utils.py\`:
\`\`\`python
def multiply(a: int, b: int) -> int:
    return a * b
\`\`\`

Add a test for it in \`tests/test_utils.py\`, then commit and push to \`origin/feature-multiply\`.

You are on the \`feature-multiply\` branch.`,
    expectedTrapIds: ["push-conflict"],
    verifyCommand: "git log --oneline origin/feature-multiply | head -1",
    goldPatch: {
      "src/gitflow/utils.py": `"""Utility functions."""


def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}!"


def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def upper(s: str) -> str:
    """Uppercase a string."""
    return s.upper()


def multiply(a: int, b: int) -> int:
    """Multiply two integers."""
    return a * b
`,
    },
  },
  {
    taskId: "gitflow-rebase-dirty-subtract",
    repoTemplateId: "gitflow",
    bugDescription:
      "Add subtract() after rebasing onto origin/main (dirty working tree).",
    problemStatement: `You need to add a \`subtract()\` function to \`src/gitflow/utils.py\` and push it. But first, rebase your branch onto \`origin/main\` (which has new commits). There may be uncommitted changes in your working tree.

Steps:
1. Rebase onto origin/main
2. Add the subtract function: \`def subtract(a: int, b: int) -> int: return a - b\`
3. Add a test for it
4. Commit and push to origin/feature-subtract`,
    expectedTrapIds: ["dirty-rebase"],
    verifyCommand: "git log --oneline origin/feature-subtract | head -1",
    goldPatch: {
      "src/gitflow/utils.py": `"""Utility functions."""


def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}!"


def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def upper(s: str) -> str:
    """Uppercase a string."""
    return s.upper()


def subtract(a: int, b: int) -> int:
    """Subtract two integers."""
    return a - b
`,
    },
  },
  {
    taskId: "gitflow-rebase-dirty-upper",
    repoTemplateId: "gitflow",
    bugDescription:
      "Fix upper() to also strip whitespace, handle dirty tree and rebase.",
    problemStatement: `The \`upper()\` function should also strip whitespace. Change it to:
\`\`\`python
def upper(s: str) -> str:
    return s.strip().upper()
\`\`\`

Update the test, rebase onto origin/main, commit, and push to origin/fix-upper.

Note: there may be uncommitted changes in the working tree that need to be handled first.`,
    expectedTrapIds: ["dirty-rebase"],
    verifyCommand: "git log --oneline origin/fix-upper | head -1",
    goldPatch: {
      "src/gitflow/utils.py": `"""Utility functions."""


def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}!"


def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def upper(s: str) -> str:
    """Uppercase a string."""
    return s.strip().upper()
`,
    },
  },
];

export const ALL_GIT_WORKFLOW_TEMPLATES: RepoTemplate[] = [GITFLOW_TEMPLATE];
export const ALL_GIT_WORKFLOW_TASKS: RecurringPatternTask[] = GIT_WORKFLOW_TASKS;
export const ALL_GIT_WORKFLOW_TRAPS: RecurringTrap[] = [
  TRAP_PUSH_CONFLICT,
  TRAP_DIRTY_REBASE,
];
