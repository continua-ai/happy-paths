# Feasibility gate (stage 0)

Before deeper architecture investment, we run a small end-to-end gate to answer:

- is repeated wrong-turn reduction measurable?
- is there enough efficiency gain to justify continuing?
- can we do this without correctness regressions?

## OFF vs ON design

For each scenario in the pack:

1. **OFF**: run suggestion retrieval with no prior captured history.
2. **ON**: ingest scenario trace history, then run suggestion retrieval.

This gives direct retrieval deltas (hit@1, hit@3, MRR).

## Feasibility proxies

The gate also reports directional efficiency proxies:

- repeated dead-end rate,
- wall-time-to-green proxy,
- token-proxy,
- recovery success rate.

Proxy model:

- baseline run outcome is derived from scenario capture events,
- for Pi-session-derived scenarios, per-step latency is computed from actual
  session timestamps (assistant step + tool execution),
- for Pi-session-derived scenarios, token/cost data is sourced from assistant
  `usage` fields in the session records,
- failure-overhead events are identified from `metrics.outcome == "failure"`,
- ON-mode retrieval rank applies a conservative assist factor:
  - rank 1 -> `1.0`
  - rank 2 -> `0.6`
  - rank 3 -> `0.35`
  - no top-3 hit -> `0.0`

This keeps the gate explicit and reproducible while we build stronger replay
harnesses.

## Interpreting trust

When reductions look high (for example, ~20% wall-time proxy reduction), treat
single-point deltas as directional and verify confidence intervals.

The trust summary uses paired bootstrap resampling over scenario estimates and
reports low/median/high intervals for:

- dead-end reduction,
- wall-time reduction,
- token-proxy reduction,
- recovery-success-on,
- expected repeated dead-ends OFF/ON/avoided.

If intervals remain clearly positive across larger scenario packs, confidence is
meaningfully stronger than a single aggregate number.

## Default go/no-go thresholds

- min relative repeated-dead-end reduction: `0.25`
- min relative wall-time reduction: `0.10`
- min relative token-proxy reduction: `0.10`
- min recovery-success-rate ON: `0.90`
- max recovery-success-rate drop: `0.00`

## Run

```bash
npm run eval:feasibility
```

JSON output:

```bash
tsx scripts/run-feasibility-gate.ts --json
```

Trust-oriented output (paired bootstrap confidence intervals + estimated avoided
repeated dead-ends):

```bash
tsx scripts/run-feasibility-gate.ts \
  --bootstrap-samples 4000 \
  --confidence-level 0.95
```

Convenience command for the skateboard E2E trust pass:

```bash
npm run eval:skateboard
```

## Observed A/B gate (measured OFF vs ON episodes)

When you want measured OFF/ON comparisons from repeated failure families across
sessions (instead of ON-side assist-factor modeling), run:

```bash
npm run eval:observed-ab -- \
  --trace-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- \
  --format pi \
  --tool-name bash
```

This command builds OFF/ON episode pairs from repeated signatures and reports
measured wall time (seconds), token counts, token proxy, retries, and bootstrap
intervals.

Pairing quality is tightened by default using adjacent transitions within each
family plus outlier filtering (`max_wall_ratio=4`, `max_token_ratio=4`). You
can tune with `--max-wall-time-ratio` and `--max-token-count-ratio`.

## Long-horizon observed A/B holdout (decision-oriented)

When moving from short-loop feasibility checks to stricter evidence, run the
long-horizon holdout benchmark:

```bash
npm run eval:observed-ab:long-horizon -- \
  --trace-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- \
  --format pi \
  --tool-name bash \
  --strict-no-family-overlap
```

This runner:

1. selects long-horizon sessions (`--min-session-duration-ms`,
   `--min-total-latency-ms`, `--min-tool-result-count`),
2. splits chronologically into older train sessions and newer eval sessions
   (`--eval-ratio`),
3. reports family-signature leakage between train/eval and can fail on leakage
   with `--strict-no-family-overlap`,
4. evaluates measured OFF vs ON episode pairs only on the eval split.

By default it writes a reproducible report to:

- `.happy-paths/observed-ab-long-horizon/report.json`

## Outcome-grounded holdout (typed issue taxonomy + abstain)

For a stricter, task-trajectory-oriented signal (instead of counting every
failure as a wrong path), run:

```bash
npm run eval:trajectory-outcome:long-horizon -- \
  --trace-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- \
  --format pi \
  --tool-name bash \
  --strict-no-family-overlap
```

This runner adds a typed issue detector over failure→success episodes:

- benign probe (exploratory/uncertain lookups),
- transient external failure (timeouts/rate limits/network),
- command mismatch,
- environment mismatch,
- missing context,
- unknown (abstain).

Primary gate metric is **harmful retry reduction** (command/env/context
mismatches), with additional constraints on wall time, token counts, recovery
success, and minimum judgeable coverage.

By default it writes:

- `.happy-paths/trajectory-outcome-long-horizon/report.json`

## Scenario pack inputs

Base fixture:

- `testdata/wrong_turn_dataset.json`

### Build a fresh dataset from JSONL traces

Contilore trace JSONL (`tool_result` events already in trace schema):

```bash
tsx scripts/build-feasibility-dataset-from-traces.ts \
  --trace-root .happy-paths \
  --format trace \
  --out /tmp/fresh_pi_scenarios.json
```

Raw Pi session JSONL (`~/.pi/agent/sessions/**.jsonl`):

```bash
tsx scripts/build-feasibility-dataset-from-traces.ts \
  --trace-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- \
  --format pi \
  --tool-name bash \
  --out /tmp/fresh_pi_scenarios.json
```

Default `--format auto` picks trace schema when present, otherwise Pi-session
parsing.

By default, long query text/signature/output fields are truncated for dataset
hygiene. Override with `--max-query-text-chars`, `--max-signature-chars`, and
`--max-tool-output-chars` if needed.

### Run feasibility gate with base + fresh datasets

```bash
tsx scripts/run-feasibility-gate.ts \
  --dataset testdata/wrong_turn_dataset.json \
  --additional-dataset /tmp/fresh_pi_scenarios.json \
  --strict
```

## Decision memo output

Generate a markdown go/no-go memo with top risks:

```bash
tsx scripts/write-feasibility-memo.ts \
  --dataset testdata/wrong_turn_dataset.json \
  --additional-dataset /tmp/fresh_pi_scenarios.json \
  --out docs/feasibility-decision.md
```

The memo includes the go/no-go decision, quantified deltas, threshold checks,
and top two risks.

## One-click sync to website evidence

From the OSS repo, generate run reports + manifest + definitions/experiment
metadata, then refresh website evidence artifacts:

```bash
npm run sync:evidence-web
```

Optional overrides:

```bash
npm run sync:evidence-web -- \
  --web-repo-root ../happy-paths-web \
  --trace-root .happy-paths/feasibility-run \
  --pi-session-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- \
  --include-pi-session true
```

This stage is intentionally small and always end-to-end; later stages should
improve fidelity, not break the loop.
