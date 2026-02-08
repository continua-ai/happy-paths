# Skateboard E2E (CON-1496)

## Goal

Single developer, single local machine, single harness (Pi), with no mandatory
external infra.

## Loop

1. Capture local traces from known wrong-turn families.
2. Build retrieval artifacts (lexical/signature first).
3. Compare OFF (cold start) vs ON (with captured recoveries) behavior.
4. Validate faster recovery with no correctness regression.

## Run

Baseline fixture-only run:

```bash
npm run eval:feasibility
```

Trust-focused run (recommended):

```bash
npm run eval:skateboard
```

Custom dataset mix:

```bash
tsx scripts/run-feasibility-gate.ts \
  --dataset testdata/wrong_turn_dataset.json \
  --additional-dataset /tmp/fresh_pi_scenarios.json \
  --bootstrap-samples 4000 \
  --confidence-level 0.95 \
  --strict
```

## What to trust

Use both:

- aggregate deltas (dead-end / wall-time / token reduction), and
- paired-bootstrap low/median/high intervals.

Also check estimated repeated dead-ends OFF → ON and avoided counts. Positive,
stable intervals across larger packs are the key signal.

## Exit criteria mapping

- Repeatable demo across multiple scenarios: run with fixture + fresh traces.
- Local-only dependency model: no external service required.
- Actionable metrics: retries/dead-ends, wall-time proxy, token proxy,
  retrieval quality, and confidence intervals.
