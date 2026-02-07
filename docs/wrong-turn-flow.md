# Wrong-turn flow (capture -> retrieve -> quality metrics)

This project includes an end-to-end evaluation loop for wrong-turn corrections.

## What it measures

For each scenario:

1. Capture and ingest trace events.
2. Retrieve suggestions for a query.
3. Score whether expected corrections appear in top results.

Reported quality metrics:

- hit@1
- hit@3
- mean reciprocal rank (MRR)

Reported efficiency rollups:

- total capture wall time
- total capture USD cost
- total capture token proxy

## Core APIs

- `runWrongTurnScenario(...)`
- `evaluateWrongTurnScenarios(...)`
- `evaluateSuggestionQualityGate(...)`
- `buildWrongTurnScenarioFromTemplate(...)`
- `buildScenarioBatchFromDataset(...)`
- `evaluateWrongTurnDataset(...)`

See:

- `src/core/wrongTurnEvaluation.ts`
- `src/core/wrongTurnDataset.ts`

## Example

`examples/wrong-turn-evaluation.ts` runs a small scenario where an initial
failing command is followed by a successful corrected command.

## Quality gate

Use `evaluateSuggestionQualityGate` to enforce minimum quality thresholds before
adopting retrieval/mining changes in CI experiments.

Example gate:

- min hit@3: `0.7`
- min MRR: `0.5`

A canonical fixture for CI lives at `testdata/wrong_turn_dataset.json`, and can
be validated with:

```bash
npm run test:wrong-turn-gate
```
