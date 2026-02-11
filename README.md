# 🤸‍♀️ Happy Paths

<p align="center">
  <img src="assets/brand/jumping-girl-mark.png" alt="Happy Paths watercolor jumping girl mark" width="220" />
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
  <a href="docs/http-ingest.md">HTTP ingest</a> ·
  <a href="docs/wrong-turn-flow.md">Wrong-turn flow</a> ·
  <a href="docs/feasibility-gate.md">Feasibility gate</a> ·
  <a href="docs/skateboard-e2e.md">Skateboard E2E</a> ·
  <a href="docs/metrics.md">Metrics</a> ·
  <a href="docs/related-work.md">Related work</a> ·
  <a href="docs/swebench-lite-lane.md">SWE-bench lane</a> ·
  <a href="docs/roadmap.md">Roadmap</a>
</p>

<p align="center">
  Contributor trust policy: <a href=".github/VOUCHED.td">VOUCHED.td</a>
</p>

---

Happy Paths is a trace-driven learning loop for agentic coding.

Happy Paths captures agent traces, indexes them quickly, mines wrong-turn
corrections, and turns those recoveries into reusable recovery skills that feed
back into future runs.

## Why this exists

Pi (and other extensible coding harnesses) let teams improve the workflow with
skills, extensions, and tooling.

That is powerful — but **figuring out when and how to extend the harness is
itself expensive and noisy**.

Happy Paths automates that learning loop end-to-end: it detects repeated
wrong turns, links them to corrections that worked, promotes those recoveries
into reusable skills/playbooks, and feeds the result back into future runs so
each run gets less wasteful over time.

## The story arc

The same failure pattern repeats at every scale. It starts with one engineer
and one agent looping on avoidable dead-ends, then compounds when multiple
agents run concurrently and replay each other’s mistakes. At team scale,
engineers rediscover similar fixes independently and the cost becomes org-wide.
The natural endpoint is opt-in global sharing of learned happy paths (similar
in spirit to skill exchange, but extracted and curated from real traces).

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

Happy Paths is correctness-first: we do not trade reliability for speed or
cost. Retrieval is lexical/signature-first (exact and near-exact matching)
before heavier semantic techniques. The default local mode has no mandatory
external database or vector dependency, and adapters/backends remain pluggable
so teams can swap harness and storage layers without rewriting core logic.

## How Happy Paths works

At runtime, the loop normalizes agent and tool events into `TraceEvent`, builds
lexical retrieval artifacts immediately, mines wrong-turn-to-correction arcs,
and then re-injects high-confidence recoveries as reusable guidance before or
during future runs. Lexical and semantic retrieval can be combined via fusion,
but the default path stays practical and deterministic.

## What exists now (on `main`)

The current implementation includes a normalized trace schema and core
interfaces, a local JSONL trace store, an in-memory lexical index, an optional
composite index (lexical + semantic fusion), wrong-turn mining, and pi adapter
hooks. It also supports local bootstrap from persisted traces across sessions,
ships an end-to-end wrong-turn evaluator (hit@1/hit@3/MRR), enforces a
fixture-based quality gate in CI, and includes source-size guardrails.

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

### pi package (plug-and-play)

This package also ships a Pi extension under `extensions/happy-paths.ts`.

Install it into Pi:

```bash
# from npm
pi install npm:@continua-ai/happy-paths

# or from source
pi install git:github.com/continua-ai/happy-paths
```

Defaults / env vars:

- Traces are stored at `~/.happy-paths/traces` by default.
- Override trace root: `HAPPY_PATHS_TRACE_ROOT=...`
- Set scope: `HAPPY_PATHS_TRACE_SCOPE=personal|team|public` (default: `personal`)
- Tune hints: `HAPPY_PATHS_MAX_SUGGESTIONS=3`
- Hint retrieval prefers non-error tool results before falling back to broader
  tool-result history.
- Learned wrong-turn artifacts are only injected when retrieval produces no
  evidence-grounded hints.
- Override extension session id (for benchmark pairing):
  `HAPPY_PATHS_SESSION_ID=swebench::<instance_id>::<off|on>::<replicate>`

Ship traces to an HTTP ingest server:

```bash
export HAPPY_PATHS_INGEST_URL=https://...               # e.g. https://...a.run.app
export HAPPY_PATHS_TEAM_ID=team_...                     # used for local shipper state scoping
export HAPPY_PATHS_TEAM_TOKEN_FILE=~/.happy-paths/team-token.txt
export HAPPY_PATHS_TRACE_ROOTS=~/.happy-paths/traces

npx @continua-ai/happy-paths ingest ship
# or
npx github:continua-ai/happy-paths ingest ship
```

## Project identity overrides

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
npm run eval:feasibility
npm run eval:skateboard
npm run eval:observed-ab -- --trace-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- --format pi --tool-name bash
npm run eval:observed-ab:long-horizon -- --trace-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- --format pi --tool-name bash --strict-no-family-overlap
npm run eval:trajectory-outcome:long-horizon -- --trace-root ~/.pi/agent/sessions/--Users-dpetrou-src-.worktrees-workspace-CON-1469-- --format pi --tool-name bash --strict-no-family-overlap
npm run memo:feasibility
npm run sync:evidence-web
```

CI enforces this gate so suggestion quality remains visible while iterating on
speed/cost optimizations.

For stage-0 go/no-go validation, use the feasibility gate flow in
`docs/feasibility-gate.md`.

The generated decision memo format lives at `docs/feasibility-decision.md`.

Beyond LLM token/cost savings, Happy Paths also tracks expensive execution
surfaces (long-running tools, test suites, CI workflows) so optimization can
target total engineering throughput, not model spend alone.

## Hosted vision

The hosted direction is opt-in sharing that can grow from personal scope to
team scope and then to broader/global scope, with privacy controls and artifact
review at each stage so learned agent improvements can be safely published and
reused at internet scale.

## Credits

Made with care by [David Petrou (@dpetrou)](https://x.com/dpetrou) and
collaborators at [Continua AI](https://continua.ai).

## License

Apache-2.0 (see `LICENSE`).
