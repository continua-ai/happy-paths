# 🤸‍♀️ Happy Paths

<p align="center">
  <img src="assets/brand/jumping-girl-mark.svg" alt="Happy Paths jumping girl mark" width="220" />
</p>

<p align="center">
  <strong>One cool trick the costly LLM providers do not want you to know:</strong><br/>
  stop paying repeatedly for the same wrong turns.
</p>

<p align="center">
  <a href="https://github.com/continua-ai/happy-paths/actions/workflows/ci.yml">
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/continua-ai/happy-paths/ci.yml?branch=main&style=for-the-badge" />
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge" />
  </a>
  <img alt="TypeScript" src="https://img.shields.io/badge/Built%20with-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
</p>

<p align="center">
  <a href="https://happypaths.dev">Website</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/wrong-turn-flow.md">Wrong-turn flow</a> ·
  <a href="docs/metrics.md">Metrics</a> ·
  <a href="docs/roadmap.md">Roadmap</a>
</p>

<p align="center">
  Contributor trust policy: <a href=".github/VOUCHED.td">VOUCHED.td</a>
</p>

---

I built Happy Paths as a trace-driven learning loop for agentic coding.

I capture agent traces, index them quickly, mine wrong-turn corrections, and
turn those recoveries into reusable recovery skills that feed back into future
runs.

## Why this exists

I use Pi (and other extensible coding harnesses) because they let me improve
my process with skills, extensions, and tooling.

That is powerful — but **figuring out when and how to extend the harness is
itself expensive and noisy**.

I built Happy Paths to automate that learning loop:

- detect repeated wrong turns,
- find corrections that worked,
- propose reusable recovery skills/playbooks,
- improve future runs automatically.

## The story arc

### 1) Single engineer, single agent

One agent repeats avoidable dead-ends. You burn time and tokens.

### 2) Single engineer, many agents

Now 5–10 concurrent agents repeat each other's mistakes. Waste compounds.

### 3) Teams

Different engineers rediscover the same fixes. Org-level costs rise.

### 4) The world

Natural extension: opt-in global crowdsourcing of learned happy paths (think
skills.sh, but with automatic trace-driven extraction and curation).

<table>
  <tbody>
    <tr>
      <td><img src="assets/marketing/single-agent.png" alt="Single engineer single agent" width="360" /></td>
      <td><img src="assets/marketing/multi-agent-single-engineer.png" alt="Single engineer multiple agents" width="360" /></td>
    </tr>
    <tr>
      <td><img src="assets/marketing/team-learning-network.png" alt="Team learning network" width="360" /></td>
      <td><img src="assets/marketing/world-crowdsource.png" alt="Global crowdsourced learning" width="360" /></td>
    </tr>
  </tbody>
</table>

> Visuals above are auto-generated concept illustrations for storytelling.

## Core principles

- **Correctness first**: never trade reliability for speed/cost.
- **Lexical-first retrieval**: signatures + exact/near-exact matching before heavy semantics.
- **Local-first default**: no required external DB/vector dependencies.
- **Pluggable everything**: harness adapters + index/store backends are replaceable.

## How Happy Paths works

1. **Capture**
   - I normalize agent/tool events into `TraceEvent`.
2. **Index**
   - I build lexical documents/signatures immediately.
   - I can optionally combine lexical + semantic indexes via fusion.
3. **Mine**
   - I detect wrong-turn -> correction arcs.
4. **Augment**
   - I surface suggestions before/while agents run.
   - I promote high-confidence patterns into reusable recovery skills and
     playbooks for agentic coding.

## What exists now (on `main`)

Today I ship:

- normalized trace schema + core interfaces
- local JSONL trace store
- in-memory lexical index
- optional composite index (lexical + semantic fusion)
- wrong-turn miner
- pi adapter hooks
- local bootstrap from persisted traces across sessions
- end-to-end wrong-turn evaluator (hit@1, hit@3, MRR)
- dataset-based quality gate in CI
- source-size guardrails in CI

## Install

Preferred (Bun-first local development):

```bash
bun install
bun run verify
```

Node/npm remains fully supported:

```bash
npm install
npm run verify
```

## Quick usage

```ts
import { createLocalLearningLoop } from "@continua-ai/happy-paths";

const loop = createLocalLearningLoop({ dataDir: ".happy-paths" });

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

### Rehydrate from persisted local traces

```ts
import { initializeLocalLearningLoop } from "@continua-ai/happy-paths";

const initialized = await initializeLocalLearningLoop({
  dataDir: ".happy-paths",
});

console.log(initialized.bootstrap.eventCount);
```

### pi adapter

```ts
import {
  createLocalLearningLoop,
  createPiTraceExtension,
} from "@continua-ai/happy-paths";

const loop = createLocalLearningLoop();
export default createPiTraceExtension({ loop });
```

## Naming is parameterized (rebrand-friendly)

Brand-specific identifiers are centralized in `src/core/projectIdentity.ts` and
can be overridden per integration.

```ts
import { createLocalLearningLoop } from "@continua-ai/happy-paths";

const loop = createLocalLearningLoop({
  projectIdentity: {
    displayName: "YourNewName",
    defaultDataDirName: ".yournewname",
    extensionCustomType: "yournewname",
  },
});
```

## Metrics and CI quality gate

Dataset fixture: `testdata/wrong_turn_dataset.json`

```bash
npm run test:wrong-turn-gate
npm run eval:wrong-turn
```

CI enforces this gate so suggestion quality remains visible while iterating on
speed/cost optimizations.

Beyond LLM token/cost savings, Happy Paths also tracks expensive execution
surfaces (long-running tools, test suites, CI workflows) so optimization can
target total engineering throughput, not model spend alone.

## Hosted vision

We intend to support hosted, opt-in sharing:

- personal scope -> team scope -> global scope,
- with privacy controls and artifact review,
- so learned agent improvements can be published and reused at internet scale.

## Icon and shorthand

Primary mark: jumping girl.

- primary mark: `assets/brand/jumping-girl-mark.svg`
- unicode shorthand: `🤸‍♀️`

## Credits

Made with care by [David Petrou (@dpetrou)](https://x.com/dpetrou) and
collaborators at [Continua AI](https://continua.ai).

## License

Apache-2.0 (see `LICENSE`).
