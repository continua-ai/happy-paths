# SWE-bench Lite lane (task pack + trace scoring)

This lane lets Happy Paths consume a deterministic SWE-bench Lite slice and score
trace outcomes with existing long-horizon gates.

It is intentionally split into two stages:

1. prepare a reproducible task pack,
2. run your agent/harness externally and capture traces,
3. score those traces with Happy Paths observed/trajectory gates.

## 1) Fetch a deterministic task pack

```bash
npm run benchmark:swebench-lite:fetch -- \
  --count 50 \
  --offset 0 \
  --out .happy-paths/benchmarks/swebench_lite_50/tasks.json
```

This pulls rows from `princeton-nlp/SWE-bench_Lite` via Hugging Face
`/rows` API and writes a local task pack (instance IDs, repo, problem statement,
commits, test metadata, patches).

## 2) (Optional) Build prompt JSONL for your runner

```bash
npm run benchmark:swebench-lite:prompts -- \
  --tasks .happy-paths/benchmarks/swebench_lite_50/tasks.json \
  --out .happy-paths/benchmarks/swebench_lite_50/prompts.jsonl
```

Each JSONL row includes `instanceId`, repo/commit metadata, and a plain-text
prompt body you can feed into your harness.

## 3) Capture traces while solving tasks

Run tasks with your preferred harness/agent and emit Happy Paths-compatible
trace JSONL into a dedicated trace root.

### Pi runner helper (recommended)

```bash
npm run benchmark:swebench-lite:pi -- \
  --tasks .happy-paths/benchmarks/swebench_lite_50/tasks.json \
  --offset 6 \
  --count 20 \
  --replicates 3 \
  --trace-root .happy-paths/benchmarks/swebench_lite_50/traces \
  --workspace-root .happy-paths/benchmarks/swebench_lite_50/workspaces \
  --out-dir .happy-paths/benchmarks/swebench_lite_50/pi_runs \
  --session-id-prefix swebench \
  --trace-state-mode isolated \
  --timeout-seconds 180 \
  --provider openai \
  --model codex-mini-latest
```

This helper:

- checks out each task repo at `base_commit`,
- hard-resets the checkout before each `off`/`on` run (clean A/B repo state),
- by default cleans `trace-root` before the run (`--no-clean-trace-root` to disable),
- supports `--trace-state-mode isolated` (default) with per-task/per-replicate
  isolation (OFF/ON share that local trace dir so ON can see OFF evidence, while
  preventing cross-task contamination),
- can seed each run from a frozen baseline corpus via `--seed-trace-root <path>`,
- when seeding isolated runs, keeps only the newly generated session file in each
  run directory (seed traces are used for retrieval warm-start but excluded from
  scored outputs),
- runs Pi twice per replicate (`off`, then `on`),
- captures logs/prompts under `pi_runs/logs/`,
- writes extension traces under `trace-root`,
- enforces a minimum timeout of 120s per task-side run (default 180s),
- supports per-variant timeout budgets (`--off-timeout-seconds`, `--on-timeout-seconds`) when ON runs need extra headroom,
- runs a provider/model preflight and fails fast if the requested pair is unavailable.

For stable comparisons, use a fixed-slice protocol (same offset/count/tasks,
same model/provider, same timeout policy) and multiple replicates (recommended `r=3`).

To preserve trajectory-level causality for OFF vs ON comparisons, use a strict
session ID format:

- `swebench::<instance_id>::<off|on>::<replicate>`

Example:

- `swebench::django__django-11179::off::r1`
- `swebench::django__django-11179::on::r1`

This lets the lane compute paired trajectory deltas on full runs (not just
static retrieval snapshots).

When session IDs follow this format, the Pi extension also attempts
instance-scoped retrieval (same `instance_id`) before falling back to global
tool-result hints.

Keep this corpus isolated under one trace root, e.g.
`.happy-paths/benchmarks/swebench_lite_50/traces`.

## 4) Score the trace corpus with long-horizon gates

Optional (explicit) canonicalization pass:

```bash
npm run benchmark:swebench-lite:canonicalize-traces -- \
  --trace-root .happy-paths/benchmarks/swebench_lite_50/traces \
  --out-root .happy-paths/benchmarks/swebench_lite_50/traces_clean \
  --session-id-prefix swebench
```

Lane scoring now canonicalizes traces by default before running measured lanes.
Use `--no-canonicalize-traces` only for debugging.

```bash
npm run benchmark:swebench-lite:lane -- \
  --tasks .happy-paths/benchmarks/swebench_lite_50/tasks.json \
  --trace-root .happy-paths/benchmarks/swebench_lite_50/traces \
  --format trace \
  --tool-name bash \
  --session-id-prefix swebench \
  --require-task-pairs \
  --min-family-disjoint-pair-count 20 \
  --out-dir .happy-paths/benchmarks/swebench_lite_50/results
```

Outputs:

- `observed_ab_report.json`
- `trajectory_outcome_report.json`
- `summary.json` (headline metrics + command provenance + `taskPairedTrajectory` deltas)

`summary.json` now includes:

- `evaluationPolicy` (primary lane = `task_paired_trajectory`)
- `qualityFlags` (including sparse long-horizon pairability flags)
- `taskPairedValidity` (run-quality coverage + censoring asymmetry checks)
- `taskPairedTrajectoryQualified` (task-paired deltas on quality-qualified pairs)

By default, the lane evaluates task-paired validity gates:

- `--min-qualified-task-paired-count` (default `3`)
- `--min-on-checkpoint-coverage` (default `0.8`)
- `--max-on-vs-off-likely-censored-rate-delta` (default `0.2`)
- `--max-on-vs-off-timeout-rate-delta` (default `0.2`, when timeout data is available)

To include exact timeout asymmetry in validity scoring, pass the run manifest from
`benchmark:swebench-lite:pi`:

- `--runs-manifest /path/to/pi_runs/manifest.json`

Use `--no-task-paired-validity-gates` to disable these checks (debug-only).
With `--strict`, validity gate failures will fail the lane command.

The trace stream also includes `checkpoint` events (`kind=happy_paths_prior_hints`)
so you can inspect hint counts (including retrieval vs artifact hints),
retrieval scope, outcome filter mode (`non_error` vs `any`), and fallback
behavior per run. Retrieval now also marks when only low-signal prior commands
were available, which surfaces as a low-signal fallback hint. If failure
signals are available at the same time, warning hints are preferred.

## Artifact publication policy (repo vs GCS)

Recommended split:

- **Public repo (small, stable evidence):**
  - `summary.json`
  - `observed_ab_report.json`
  - `trajectory_outcome_report.json`
  - run `manifest.json`
  - optional checksum/pointer metadata
- **GCS (bulk provenance payloads):**
  - raw trace JSONL trees
  - runner stdout/stderr logs
  - compressed full bundles (`runs + traces + results`)

Practical rule of thumb:

- If a full artifact bundle is very small (for example <= 10 MB compressed),
  you may include it directly in GitHub for convenience.
- Otherwise keep the repo lean: commit only the small evidence set and publish
  full payloads in GCS with URI + SHA256 recorded in repo metadata.

## Notes

- This lane does **not** execute SWE-bench itself; it prepares tasks and scores
  traces you captured.
- `--require-task-pairs` will fail the run if no trajectory pairs can be built
  from session IDs.
- Interpret `taskPairedTrajectory` as the primary causal OFF/ON comparison lane,
  especially when long-horizon holdout pair counts are sparse.
- If `taskPairedValidity.gateResult.pass` is false, treat task-paired deltas as
  provisional and prefer `taskPairedTrajectoryQualified` for quality-sensitive
  comparisons.
- When `--runs-manifest` is provided, `taskPairedValidity.summary` also includes
  exact ON/OFF timeout rates and timeout-rate delta (instead of relying only on
  likely-censored proxies).
- Use long-horizon observed/trajectory lanes as secondary diagnostics until
  pairability is sufficiently powered.
- Benchmark-agnostic policy: do **not** tune retrieval/hint behavior on specific
  SWE-bench instances. Keep policy changes global, then re-measure on the fixed
  protocol slice.
- Use this as benchmark evidence generation, not as a substitute for correctness
  validation of patch outputs.
