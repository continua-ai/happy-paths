# Contilore

Trace-driven learning loop for coding agents.

Capture agent traces, index them quickly, mine wrong-turn corrections, and feed
high-confidence hints back into future runs.

## Why this exists

Agentic coding burns time and tokens on repeated dead ends. This is amplified
across many concurrent agents and teammates.

Contilore turns traces into reusable learning artifacts:

- **anti-patterns** (what to avoid)
- **happy paths** (what tends to work)
- **playbooks** (small, reviewable recipes)

## Principles

- **Correctness first**: never trade reliability for speed/cost.
- **Lexical-first retrieval**: signatures + BM25-style behavior before heavy
  semantic indexing.
- **Out-of-the-box local mode**: no mandatory external DB/vector service.
- **Pluggable architecture**: harness adapters and storage/index backends are
  replaceable.

## Current status

Early scaffold / MVP foundations:

- normalized trace schema
- local JSONL trace store
- in-memory lexical index
- basic wrong-turn miner
- pi adapter hook layer
- metrics helpers (correctness + wall time + cost + token proxy)
- end-to-end wrong-turn evaluation flow with hit@k + MRR quality metrics

## Install

```bash
npm install
npm run verify
```

### Optional: Bun

This repo is TypeScript-first and Node-compatible. Bun can be used as an
alternative task runner (`bun run ...`) when available.

## Quick usage

```ts
import { createLocalLearningLoop } from "@continua-ai/contilore";

const loop = createLocalLearningLoop({ dataDir: ".contilore" });

await loop.ingest({
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  sessionId: "session-1",
  harness: "pi",
  scope: "personal",
  type: "tool_result",
  payload: {
    command: "npm test",
    output: "Error: Cannot find module x",
    isError: true,
  },
  metrics: { outcome: "failure" },
});

const hits = await loop.retrieve({ text: "cannot find module" });
console.log(hits[0]);
```

To rehydrate retrieval/mining state from persisted local traces at startup:

```ts
import { initializeLocalLearningLoop } from "@continua-ai/contilore";

const initialized = await initializeLocalLearningLoop({
  dataDir: ".contilore",
});

console.log(initialized.bootstrap.eventCount);
```

## pi adapter

The pi adapter is intentionally thin and uses a pi-like event API contract.

```ts
import {
  createLocalLearningLoop,
  createPiTraceExtension,
} from "@continua-ai/contilore";

const loop = createLocalLearningLoop();
export default createPiTraceExtension({ loop });
```

## Project naming is parameterized

Brand-specific identifiers are centralized in `src/core/projectIdentity.ts` and
can be overridden per integration:

```ts
import { createLocalLearningLoop } from "@continua-ai/contilore";

const loop = createLocalLearningLoop({
  projectIdentity: {
    displayName: "YourNewName",
    defaultDataDirName: ".yournewname",
    extensionCustomType: "yournewname",
  },
});
```

## End-to-end wrong-turn evaluation

Use the built-in evaluator to measure suggestion quality and efficiency from
captured traces:

```ts
import {
  buildWrongTurnScenarioFromTemplate,
  createLocalLearningLoop,
  evaluateWrongTurnScenarios,
} from "@continua-ai/contilore";

const scenario = buildWrongTurnScenarioFromTemplate(/* ... */);
const report = await evaluateWrongTurnScenarios([scenario], () => {
  return createLocalLearningLoop();
});
```

See `examples/wrong-turn-evaluation.ts`.

A dataset-driven gate is also included (`testdata/wrong_turn_dataset.json`):

```bash
npm run test:wrong-turn-gate
```

This provides a CI-friendly quality floor for hit@k and MRR.

## Architecture docs

- `docs/architecture.md`
- `docs/metrics.md`
- `docs/wrong-turn-flow.md`
- `docs/engineering-practices.md`

## CI and guardrails

CI runs:

- lint + typecheck + tests
- wrong-turn dataset quality gate (`npm run eval:wrong-turn`)
- source-file-size guardrails

## License

Apache-2.0 (see `LICENSE`).
