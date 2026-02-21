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

### Repos

Two small Python projects, each with realistic structure (pyproject.toml,
requirements.txt, tests, setup.py):

- **pymath**: math utilities (stats, linalg, conversions)
- **dataproc**: data processing (CSV parsing, JSON validation, dates, encoding)

### Tasks (8 total)

Each task has a unique, non-trivial bug to fix. The bugs range from
off-by-one errors to missing edge-case handling.

| Task | Repo | Bug |
|---|---|---|
| pymath-001 | pymath | `mean()` crashes on empty list |
| pymath-002 | pymath | `stdev()` ignores `population` parameter |
| pymath-003 | pymath | `transpose()` fails on non-square matrices |
| pymath-004 | pymath | `celsius_to_fahrenheit()` wrong formula |
| dataproc-001 | dataproc | CSV parser doesn't handle quoted commas |
| dataproc-002 | dataproc | JSON validator rejects empty arrays |
| dataproc-003 | dataproc | `date_range()` end date is exclusive |
| dataproc-004 | dataproc | `read_text()` doesn't strip UTF-8 BOM |

### Recurring traps (6 unique)

These are intentional failure patterns embedded in the repos. They're not the
bug the agent needs to fix — they're obstacles along the way that recur across
tasks.

| Trap | Family | Tasks | Description |
|---|---|---|---|
| missing-pytest-cov | env_dep | all 8 | pyproject.toml has `--cov` addopts but pytest-cov isn't installed |
| broad-pytest-suite | tool_flag | all 8 | bare `pytest` runs slow integration tests (30s sleep) |
| pytest-import-error-conftest | env_dep | all 8 | package not installed in editable mode |
| missing-pyyaml | env_dep | dataproc (4) | code imports yaml but PyYAML not in requirements.txt |
| missing-config-yaml | config | dataproc (integration) | config.yaml doesn't exist (only .example) |
| missing-env-secret-key | config | dataproc (integration) | SECRET_KEY env var not set |

### What makes this different from SWE-bench

| Property | SWE-bench Lite | Recurring-pattern |
|---|---|---|
| Task relationship | Unrelated bugs | Shared failure modes |
| Recurring patterns | None (by design) | Core design principle |
| Repo setup | Real GitHub repos | Synthetic (controlled) |
| Agent obstacles | Incidental | Intentional, measurable |
| Learning signal | None to learn from | Clear cross-task signal |

## Usage

### Build the benchmark repos

```bash
tsx scripts/build-recurring-pattern-benchmark.ts --out /tmp/rp-benchmark
```

This creates:

- `/tmp/rp-benchmark/repos/pymath/` — git repo with bugs
- `/tmp/rp-benchmark/repos/dataproc/` — git repo with bugs
- `/tmp/rp-benchmark/benchmark.json` — task pack

### Run with Pi

```bash
tsx scripts/run-recurring-pattern-pi.ts \
  --benchmark /tmp/rp-benchmark/benchmark.json \
  --out-dir /tmp/rp-results \
  --replicates 2 \
  --timeout-seconds 180 \
  --trace-state-mode shared
```

Key options:

- `--trace-state-mode shared`: all tasks share the same trace store (so ON
  runs can learn from earlier runs)
- `--trace-state-mode isolated`: each task gets its own trace store (no
  cross-task learning; for baseline measurement)
- `--task-filter pymath`: only run pymath tasks
- `--on-hint-mode full|artifact_only|none`: control hint types

### Analyze results

Results are in the manifest JSON (`/tmp/rp-results/manifest.json`) and
per-run logs (`/tmp/rp-results/logs/`).

Key metrics to look for:

1. **Trap encounter rate**: how often does the agent hit each trap?
2. **Trap recovery time**: how many retries before the agent fixes the trap?
3. **Cross-task transfer**: does trap recovery improve on later tasks (shared
   mode) vs isolated mode?
4. **Bug fix rate**: does trap assistance improve or degrade bug fix success?

## Extending the benchmark

### Adding tasks

1. Add a new entry to `PYMATH_TASKS` or `DATAPROC_TASKS` in
   `src/benchmarks/recurringPatternTemplates.ts`
2. Ensure the task references valid `expectedTrapIds`
3. Provide a `goldPatch` and `verifyCommand`
4. Run `npx vitest run tests/recurring-pattern.test.ts` to validate

### Adding repos

1. Add a new template to `ALL_TEMPLATES` in `recurringPatternTemplates.ts`
2. Include at least some of the shared traps (missing-pytest-cov,
   broad-pytest-suite) to maintain cross-repo recurrence
3. Add repo-specific traps as needed

### Adding traps

1. Define a new `RecurringTrap` constant
2. Add it to the relevant template's `traps` array
3. Add it to `ALL_TRAPS`
4. Reference it from task `expectedTrapIds`
5. Ensure the trap actually fires (verify manually)

## Verification

The benchmark builder verifies repos are clean git repos. The test suite
(`tests/recurring-pattern.test.ts`) validates:

- All tasks reference valid templates and traps
- Every trap recurs across at least 2 tasks
- Task prompts don't leak trap information
- Templates embed the expected traps (e.g., pyproject.toml has `--cov`)

## Related

- CON-1728: Happy Paths recurring-pattern benchmark + multi-checkpoint hints
- CON-1469: Trace-driven learning loop for Pi
- `src/benchmarks/recurringPattern.ts`: types and utilities
- `src/benchmarks/recurringPatternTemplates.ts`: repo templates and tasks
- `scripts/build-recurring-pattern-benchmark.ts`: benchmark generator
- `scripts/run-recurring-pattern-pi.ts`: benchmark runner
