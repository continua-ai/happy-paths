# Recurring-pattern benchmark

## Why this exists

SWE-bench Lite tests whether learning from unrelated bugs helps solve new bugs.
The answer is consistently no — hints add noise, not signal.

The recurring-pattern benchmark tests the core Happy Paths hypothesis: **can
learning from repeated wrong turns help agents avoid the same mistakes?**

The key difference: tasks intentionally share failure modes across different
repos and bug types. When an agent hits `ModuleNotFoundError: No module named
'pytest_cov'` on task 1, that trace should help it avoid the same trap on
task 5 — even though task 5 is a completely different bug in a different repo.

## Design

### Repos (14 total)

Three benchmark suites targeting different failure modes:

**Error recovery (10 repos)** — undocumented tools, misdirecting errors,
non-standard setup:

- **pymath**: math utilities (stats, linalg, conversions)
- **dataproc**: data processing (CSV parsing, JSON validation, dates, encoding)
- **taskapi**: task management API
- **buildkit**: build tool with custom CLI
- **calclib**: calculator library
- **webutil**: web utilities with session fixture timeout trap
- **ledgerkit**: ledger tool with undocumented `./kit` CLI (no README)
- **logparse**: log parser with undocumented `./qa` CLI (no README)
- **monobuild**: monorepo build tool (`./mb fmt` required before lint/test)
- **toolhub**: tool orchestration with hallucinated tool name traps

**Reinvention waste (3 repos)** — tests whether agents reuse existing CLI
tools vs writing throwaway scripts (151-191 files each):

- **issuetracker**: issue tracking with `./track` CLI
- **opsboard**: operations dashboard with `./ops` CLI
- **dataquery**: JSON data analysis with `jq` workflows

**Git workflow (1 repo)** — tests push-conflict and dirty-rebase recovery:

- **gitflow**: Python project with local bare remote and pre-staged divergence

### Tasks (56 total)

Each task has a unique bug to fix or operation to perform. Tasks share
failure modes across repos.

### Traps (27 unique)

| Family | Traps | Description |
|---|---|---|
| env_dep (7) | missing-pytest-cov, missing-pyyaml, pytest-import-error-conftest, internal-vendor-dep, missing-test-env, phantom-plugins-dep, system-python-missing-module | Missing dependencies or env setup |
| tool_flag (5) | broad-pytest-suite, undocumented-fixtures-tool, undocumented-testdata-tool, fmt-before-lint, build-target-syntax | Non-obvious tool usage patterns |
| config (2) | missing-config-yaml, missing-env-secret-key | Missing config files or env vars |
| tool_setup (3) | session-fixture-timeout, hallucinated-tool, config-not-found-hallucinated | Misdirecting error messages |
| reinvention (5) | reinvent-issue-tracker-query, reinvent-issue-tracker-mutation, reinvent-deploy-status, reinvent-log-query, reinvent-json-extraction | Agent writes heredoc instead of using CLI |
| git_workflow (2) | push-conflict, dirty-rebase | Standard git errors requiring recovery |

### What makes this different from SWE-bench

| Property | SWE-bench Lite | Recurring-pattern |
|---|---|---|
| Task relationship | Unrelated bugs | Shared failure modes |
| Recurring patterns | None (by design) | Core design principle |
| Repo setup | Real GitHub repos | Synthetic (controlled) |
| Agent obstacles | Incidental | Intentional, measurable |
| Learning signal | None to learn from | Clear cross-task signal |

## Results summary

### Error recovery (v11 — current best policy)

Error-time hints with prescriptive recipes. Key repos:

| Repo | OFF median | ON median | Delta | Notes |
|---|---|---|---|---|
| ledgerkit | 65s | 58s | **−11%** | Undocumented CLI, no README |
| logparse | 51s | 49s | **−4%** | Undocumented CLI, no README |
| webutil | 91s | 92s | +1% | Misdirecting errors |
| toolhub (r=5) | 48s | 54s | +10% | Well-documented, hints harmful |
| monobuild | 158s | 170s | +7% | Agent finds ./mb from README |

### Reinvention waste (v3 → v4)

| Version | Intervention | Heredocs (36 runs) | CLI usage | Token waste |
|---|---|---|---|---|
| v3 baseline | None | 9 | 59 | 1,048 |
| v3 + hints | Tool-call hints | 6 | 67 | 971 (−7%) |
| **v4 registry** | **AGENTS.md tool registry** | **0** | **163 (2.8×)** | **0 (−100%)** |

### Git workflow

| Task | OFF median | ON median | Delta |
|---|---|---|---|
| push-after-diverge | 77s | 85s | +10% |
| push-conflict-multiply | 38s | 36s | −5% |
| rebase-dirty-subtract | 46s | 47s | +2% |
| rebase-dirty-upper | 50s | 60s | +20% |

Hints net-harmful (+10% overall). Models handle standard git errors.

### Key findings

1. **Hints help when errors misdirect and tools are undocumented** (ledgerkit,
   logparse)
2. **Hints hurt on well-documented repos** (toolhub, monobuild) and standard
   errors (git push conflicts)
3. **AGENTS.md tool registry is the highest-ROI intervention** — eliminates
   reinvention waste entirely (0 heredocs, 2.8× CLI usage)
4. **One comprehensive hint > many small hints**
5. **Error-time delivery > pre-session injection**
6. **Don't hint what the model already knows**

## Usage

### Build the benchmark repos

```bash
# Error recovery only
tsx scripts/build-recurring-pattern-benchmark.ts --out /tmp/rp-benchmark

# Include reinvention repos
tsx scripts/build-recurring-pattern-benchmark.ts --out /tmp/rp-benchmark --include-reinvention

# Include reinvention + git workflow
tsx scripts/build-recurring-pattern-benchmark.ts --out /tmp/rp-benchmark --include-all

# With AGENTS.md tool registry (for reinvention v4)
tsx scripts/build-recurring-pattern-benchmark.ts --out /tmp/rp-benchmark --include-reinvention --with-agents-md
```

### Run with Pi

```bash
tsx scripts/run-recurring-pattern-pi.ts \
  --benchmark /tmp/rp-benchmark/benchmark.json \
  --out-dir /tmp/rp-results \
  --replicates 3 \
  --timeout-seconds 240 \
  --trace-state-mode isolated \
  --provider openai-codex --model gpt-5.3-codex
```

Key options:

- `--trace-state-mode shared`: all tasks share trace store (cross-task learning)
- `--trace-state-mode isolated`: separate stores (baseline measurement)
- `--task-filter 'regex'`: filter tasks by regex (e.g., `'ledgerkit|logparse'`)
- `--no-before-agent-start`: disable pre-session hints (error-time only)

### Analyze reinvention results

```bash
tsx scripts/analyze-reinvention-results.ts \
  --results /tmp/rp-results \
  --trace-root /tmp/rp-traces
```

## Extending the benchmark

### Adding tasks

1. Add entries to the appropriate template file:
   - `recurringPatternTemplates.ts` (error recovery)
   - `reinventionTemplates.ts` (reinvention waste)
   - `gitWorkflowTemplates.ts` (git workflow)
2. Ensure the task references valid `expectedTrapIds`
3. Provide a `goldPatch` and `verifyCommand`
4. Run `npx vitest run tests/recurring-pattern.test.ts` to validate

### Adding repos

1. Add a new template to the appropriate templates file
2. Include shared traps for cross-repo recurrence
3. For git-workflow repos, add setup logic in `gitWorkflowSetup.ts`
4. For reinvention repos, add scale files in `reinventionScaleFiles.ts`

## Related

- CON-1728: Happy Paths recurring-pattern benchmark + multi-checkpoint hints
- CON-1469: Trace-driven learning loop for Pi
- `src/benchmarks/recurringPattern.ts`: types and utilities
- `src/benchmarks/recurringPatternTemplates.ts`: error recovery templates
- `src/benchmarks/reinventionTemplates.ts`: reinvention waste templates
- `src/benchmarks/gitWorkflowTemplates.ts`: git workflow templates
- `scripts/build-recurring-pattern-benchmark.ts`: benchmark generator
- `scripts/run-recurring-pattern-pi.ts`: benchmark runner
- `scripts/analyze-reinvention-results.ts`: reinvention waste analyzer
