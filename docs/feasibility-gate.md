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
