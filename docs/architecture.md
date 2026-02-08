# Architecture

I intentionally split Happy Paths into pluggable layers for agentic coding.
I want the default path to stay simple, local, and correctness-first.

## Design goals

1. **Correctness first**: never make the agent less reliable.
2. **Fast first win**: lexical/signature retrieval works immediately.
3. **Optional depth**: embeddings/vector/reranking are add-ons, not requirements.
4. **Harness agnostic**: pi is the first adapter, not the last.

## Layering

### 1) Harness adapters

Harness adapters convert runtime-specific events into normalized `TraceEvent`.

- Current: `adapters/pi`
- Future: adapters for other coding harnesses can target the same core interfaces.

### 2) Core loop

`LearningLoop` orchestrates:

- append to store
- build index documents
- update retrieval index
- feed mining pipeline

Core contracts are in `src/core/interfaces.ts`:

- `TraceStore`
- `TraceIndex`
- `TraceMiner`
- `EventDocumentBuilder`

### 3) Storage/index backends

Current default backend (`backends/local`):

- `FileTraceStore`: append-only JSONL (no external services)
- `InMemoryLexicalIndex`: lightweight lexical retrieval
- `initializeLocalLearningLoop`: bootstrap index/miner state from stored traces

This gives an out-of-the-box dev experience, including cross-session reuse of
previous traces.

Optional backends can be added without changing core:

- SQLite/Postgres stores
- BM25 engines
- Vector databases
- rerankers

`CompositeTraceIndex` can combine a lexical-first primary index with an optional
secondary semantic index using reciprocal rank fusion.

### 4) Mining

Current miner (`SimpleWrongTurnMiner`) finds basic wrong-turn -> correction arcs.

Future miners should use stronger signals:

- repeated failure signatures
- reverted edits/backtracking
- eventual success checks (tests/lint/typecheck)
- cross-session clustering

### 5) Evaluation, quality gating, and adaptive rollout

`wrongTurnEvaluation` provides end-to-end measurement for:

- capture + ingest
- retrieval + suggestion generation
- quality metrics (hit@k, MRR)
- efficiency rollups (wall time, cost, token proxy)

Quality gates can block regressions before rollout.

`src/core/pathLifecycle.ts` now provides a baseline lifecycle schema and helpers
for version assignment + canary decisions:

- `HappyPathArtifact` / `HappyPathVersion`
- deterministic canary assignment (`assignPathVersion`)
- promotion/rollback/hold evaluation (`decideCanaryAction`)

This enables staged rollout of new paths before broad promotion.

## Why lexical-first

Large raw trace corpora are noisy and expensive for fully semantic retrieval.

We prioritize:

1. exact signatures (error lines, command fingerprints, file paths)
2. lexical retrieval
3. semantic add-ons for distilled artifacts

This keeps latency and cost low while preserving precision.
