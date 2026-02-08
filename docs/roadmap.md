# Roadmap

## Big ideas

- **Prediction is compression**: if we can predict likely future wrong turns, we
  can represent and reuse execution knowledge with much lower token/time cost.
- **Batchactive-style lookahead for agents**: proactively evaluate a small set
  of likely next branches so recovery candidates are ready when the user asks.
- **Correctness-first acceleration**: latency and cost wins only count if
  recovery success and safety gates stay intact.

## Phase 0 (current)

- schema + core interfaces
- local storage/index defaults
- basic wrong-turn miner
- pi adapter
- end-to-end wrong-turn evaluator (capture -> retrieval -> quality metrics)

## Phase 1

- stronger lexical ranking (BM25 / FTS backend)
- near-duplicate clustering for repeated mistakes
- confidence calibration and quality gates

## Phase 2

- optional vector backend plugin
- optional reranker plugin
- path matcher service (intent + context aware retrieval)
- path versioning + canary rollouts (cohort/channel scoped)
- batch/offline mining jobs

## Phase 3

- team scope with explicit sharing controls
- artifact review workflow before publish
- trust/safety pipeline for shared paths (policy checks + sandbox replay)
- public playbook export format

## Phase 4

- additional harness adapters (non-pi, including Claude/Codex-style runtimes)
- non-coding workflow support (assistant/ops automation paths)
- benchmark suite with correctness + efficiency reporting
- friction hotspot reporting to identify APIization bottlenecks in external services
