# Feasibility decision memo

- Decision: **GO**
- Summary: Decision: GO | Scenarios: 4 | Dead-end reduction: 1.000 | Wall-time reduction: 0.325 | Token-proxy reduction: 0.304 | Recovery success on: 1.000

## OFF vs ON retrieval

- OFF hit@1: 0.000
- OFF hit@3: 0.000
- OFF MRR: 0.000
- ON hit@1: 0.250
- ON hit@3: 1.000
- ON MRR: 0.500

## Feasibility deltas

- Repeated dead-end rate: 1.000 -> 0.000 (relative reduction 1.000)
- Wall time proxy (ms): 1220.0 -> 823.0 (relative reduction 0.325)
- Token proxy: 900.0 -> 626.0 (relative reduction 0.304)
- Recovery success rate: 1.000 -> 1.000 (delta 0.000)

## Threshold checks

- Gate pass: true

## Top risks

- **Small scenario sample**: Current feasibility run uses fewer than 5 scenarios; confidence is limited and should be expanded with fresh Pi traces.
- **Cold-start baseline may be too weak**: OFF retrieval currently finds no top-3 matches. Validate against a stronger baseline and larger scenario mix to avoid overestimating gains.

