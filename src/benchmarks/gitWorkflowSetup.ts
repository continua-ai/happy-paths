/**
 * Git-workflow benchmark repo setup.
 *
 * After the initial git commit, this sets up:
 * - A local bare "remote" (origin)
 * - Pre-staged branch divergence for push-conflict tasks
 * - Pre-staged dirty working tree for dirty-rebase tasks
 *
 * Called by the benchmark builder after creating the repo directory.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "benchmark",
  GIT_AUTHOR_EMAIL: "benchmark@example.com",
  GIT_COMMITTER_NAME: "benchmark",
  GIT_COMMITTER_EMAIL: "benchmark@example.com",
};

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    env: GIT_ENV,
  }).trim();
}

/**
 * Set up the gitflow repo for push-conflict and dirty-rebase tasks.
 *
 * Layout after setup:
 * - <repoDir>: the working repo (the agent operates here)
 * - <repoDir>/../gitflow-remote.git: bare remote
 *
 * Branch state per task:
 * - fix-greeting: local and remote both have commits, diverged
 * - feature-multiply: local and remote both have commits, diverged
 * - feature-subtract: clean branch, but main has advanced on remote
 * - fix-upper: clean branch, main advanced, plus dirty working tree
 */
export function setupGitWorkflowRepo(repoDir: string): void {
  const remoteDir = join(repoDir, "..", "gitflow-remote.git");
  mkdirSync(remoteDir, { recursive: true });

  // Create bare remote and push main to it.
  git("init --bare", remoteDir);
  // Ensure the default branch is named "main".
  git("branch -M main", repoDir);
  git(`remote add origin ${remoteDir}`, repoDir);
  git("push -u origin main", repoDir);

  // ── Push-conflict setup (fix-greeting, feature-multiply) ──────────

  // Create fix-greeting branch with a local commit.
  git("checkout -b fix-greeting", repoDir);
  writeFileSync(
    join(repoDir, "CHANGELOG.md"),
    "# Changelog\n\n## 0.1.1\n- Local change on fix-greeting\n",
  );
  git("add CHANGELOG.md", repoDir);
  git('commit -m "local: add changelog on fix-greeting"', repoDir);
  git("push -u origin fix-greeting", repoDir);

  // Now simulate remote divergence: clone to a temp dir, make a different
  // commit on fix-greeting, push it, then our local is behind.
  const cloneDir = join(repoDir, "..", "gitflow-clone-tmp");
  git(`clone ${remoteDir} ${cloneDir}`, repoDir);
  git("checkout fix-greeting", cloneDir);
  writeFileSync(
    join(cloneDir, "CONTRIBUTING.md"),
    "# Contributing\n\nPlease open a PR.\n",
  );
  git("add CONTRIBUTING.md", cloneDir);
  git('commit -m "remote: add CONTRIBUTING on fix-greeting"', cloneDir);
  git("push origin fix-greeting", cloneDir);

  // Back in our repo: make another local commit so we truly diverge.
  writeFileSync(
    join(repoDir, "CHANGELOG.md"),
    "# Changelog\n\n## 0.1.1\n- Local change on fix-greeting\n- Another local change\n",
  );
  git("add CHANGELOG.md", repoDir);
  git('commit -m "local: update changelog again"', repoDir);

  // Go back to main.
  git("checkout main", repoDir);

  // Create feature-multiply branch with similar divergence.
  git("checkout -b feature-multiply", repoDir);
  writeFileSync(
    join(repoDir, "notes.md"),
    "# Notes\n\nLocal notes for multiply feature.\n",
  );
  git("add notes.md", repoDir);
  git('commit -m "local: add notes on feature-multiply"', repoDir);
  git("push -u origin feature-multiply", repoDir);

  // Diverge via clone: re-clone to get the feature-multiply branch.
  const cloneDir2 = join(repoDir, "..", "gitflow-clone-tmp2");
  git(`clone ${remoteDir} ${cloneDir2}`, repoDir);
  git("checkout feature-multiply", cloneDir2);
  writeFileSync(
    join(cloneDir2, "REVIEW.md"),
    "# Review Notes\n\nRemote review notes.\n",
  );
  git("add REVIEW.md", cloneDir2);
  git('commit -m "remote: add review notes on feature-multiply"', cloneDir2);
  git("push origin feature-multiply", cloneDir2);
  execSync(`rm -rf ${cloneDir2}`, { stdio: "pipe" });

  // Local divergence.
  writeFileSync(join(repoDir, "TODO.md"), "# TODO\n\n- Implement multiply\n");
  git("add TODO.md", repoDir);
  git('commit -m "local: add TODO on feature-multiply"', repoDir);

  git("checkout main", repoDir);

  // ── Dirty-rebase setup (feature-subtract, fix-upper) ──────────────

  // Advance main on remote so rebase is needed.
  git("checkout main", cloneDir);
  writeFileSync(
    join(cloneDir, "src/gitflow/version.py"),
    '"""Version info."""\n\n__version__ = "0.2.0"\n',
  );
  git("add src/gitflow/version.py", cloneDir);
  git('commit -m "bump version to 0.2.0"', cloneDir);
  git("push origin main", cloneDir);

  // feature-subtract: clean branch, but main has advanced.
  git("checkout -b feature-subtract", repoDir);
  git("push -u origin feature-subtract", repoDir);
  // Leave working tree clean for this task — the agent will make changes.

  git("checkout main", repoDir);

  // fix-upper: branch + dirty working tree.
  git("checkout -b fix-upper", repoDir);
  // Add uncommitted changes to simulate dirty tree.
  writeFileSync(
    join(repoDir, "scratch.txt"),
    "Some work in progress that hasn't been committed yet.\n",
  );
  // Don't stage scratch.txt — it's an untracked file that makes rebase
  // complain only if there are also staged/modified tracked files.
  // Instead, modify an existing tracked file:
  writeFileSync(
    join(repoDir, "README.md"),
    `# gitflow

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

## WIP notes (uncommitted)
- Thinking about adding strip() to upper()
`,
  );

  // Don't go back to main — leave the agent on the task branch.
  // The runner will checkout the appropriate branch per task.

  // Clean up clone.
  execSync(`rm -rf ${cloneDir}`, { stdio: "pipe" });
}

/**
 * Prepare the repo for a specific task by checking out the right branch.
 */
export function prepareGitWorkflowTask(repoDir: string, taskId: string): void {
  const branchMap: Record<string, string> = {
    "gitflow-push-after-diverge": "fix-greeting",
    "gitflow-push-conflict-add-fn": "feature-multiply",
    "gitflow-rebase-with-dirty-tree": "feature-subtract",
    "gitflow-rebase-dirty-fix": "fix-upper",
  };

  const branch = branchMap[taskId];
  if (branch) {
    // Stash any dirty state, switch branch, and if the task is dirty-rebase,
    // re-apply the dirty state.
    try {
      git("stash --include-untracked", repoDir);
    } catch {
      // No changes to stash.
    }
    git(`checkout ${branch}`, repoDir);

    // For dirty-rebase tasks, re-create the dirty state.
    if (taskId === "gitflow-rebase-dirty-fix") {
      writeFileSync(
        join(repoDir, "README.md"),
        `# gitflow

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

## WIP notes (uncommitted)
- Thinking about adding strip() to upper()
`,
      );
      writeFileSync(
        join(repoDir, "scratch.txt"),
        "Some work in progress that hasn't been committed yet.\n",
      );
    }
  }
}
