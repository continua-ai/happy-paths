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
- failure-overhead events are identified from `metrics.outcome == "failure"`,
- ON-mode retrieval rank applies a conservative assist factor:
  - rank 1 -> `1.0`
  - rank 2 -> `0.6`
  - rank 3 -> `0.35`
  - no top-3 hit -> `0.0`

This keeps the gate explicit and reproducible while we build stronger replay
harnesses.

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
node scripts/run-feasibility-gate.mjs --json
```

## Scenario pack inputs

Base fixture:

- `testdata/wrong_turn_dataset.json`

You can add fresh scenarios (for example, distilled from recent Pi traces) via
additional dataset files in the same schema:

```bash
node scripts/run-feasibility-gate.mjs \
  --dataset testdata/wrong_turn_dataset.json \
  --additional-dataset /path/to/fresh_pi_scenarios.json \
  --strict
```

This stage is intentionally small and always end-to-end; later stages should
improve fidelity, not break the loop.
