# Metrics

## North-star outcomes

1. **Correctness** (must not regress)
2. **Wall time** to successful task
3. **Cost** per successful task

## Correctness metrics

Track at task-level:

- success rate (pass/fail)
- first-pass success rate
- regression rate after applying suggestion

If correctness drops, reject optimization gains.

## Outcome-grounded trajectory evaluator

Failure events are not all equally bad. We distinguish:

- benign probes (expected exploratory misses like uncertain lookups),
- transient external failures (timeouts/rate limits/network),
- harmful retries (command mismatch, environment mismatch, missing context),
- unknown (abstain when confidence is low).

Primary measured gate metric for long-horizon holdouts is relative reduction in
**harmful retries** (not raw failure count), plus wall-time/token deltas and
judgeable-coverage thresholds.

For trajectory holdouts, evaluate and report both lanes:

- `full_eval` (all eval episodes),
- `family_disjoint_eval` (families unseen in train).

Use `family_disjoint_eval` as the default primary claim lane, with optional
overlap-rate caps for stricter evidence hygiene.

Calibration loop for this evaluator:

1. generate labeled sample (`npm run eval:trajectory-calibration-sample`),
2. prepare dual-review packets
   (`npm run eval:trajectory-calibration:prepare-dual-review`),
3. label with rubric (`docs/trajectory-calibration-rubric.md`),
4. adjudicate reviewer outputs
   (`npm run eval:trajectory-calibration:adjudicate`),
5. score confusion/harmful/abstain metrics
   (`npm run eval:trajectory-calibration-summary`),
6. run threshold sweep for initial operating point selection
   (`npm run eval:trajectory-calibration:tune-thresholds`).

## Suggestion quality metrics

For wrong-turn retrieval quality, track:

- hit@1 (expected correction appears in first suggestion)
- hit@3
- mean reciprocal rank (MRR)

Use quality gates so efficiency changes cannot silently degrade correctness.

## Efficiency metrics

- p50/p95 wall time to green
- retries per successful task
- provider-reported USD cost
- expensive tool/runtime spend (e.g., long-running local tools, test suites)
- CI workflow cost/latency (job minutes, reruns, queue delays)

## Token proxy (when USD is unavailable)

We track tokens by class:

- uncached input
- cached input
- output
- thinking/reasoning (if exposed)
- cache write

Default weighted proxy:

- uncached input: 1.0
- cached input: 0.2
- output: 1.0
- thinking: 1.0
- cache write: 0.2

`tokenProxy` is directional (good for comparisons), not a billing source of truth.

## Reporting format

For any experiment, report:

- correctness delta
- wall-time delta
- cost delta
- token-proxy delta
- sample size and task mix

Avoid single-metric wins without correctness checks.
