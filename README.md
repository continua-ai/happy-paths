# 🤸‍♀️ Happy Paths

<p align="center">
  <img src="assets/brand/jumping-girl-mark.png" alt="Happy Paths watercolor jumping girl mark" width="220" />
</p>

<p align="center">
  <strong>Stop paying repeatedly for the same wrong turns.</strong>
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
  <a href="docs/recurring-pattern-benchmark.md">Benchmark</a> ·
  <a href="docs/roadmap.md">Roadmap</a>
</p>

<p align="center">
  Contributor trust policy: <a href=".github/VOUCHED.td">VOUCHED.td</a>
</p>

---

Happy Paths is a trace-driven learning loop for agentic coding. It captures
agent traces, indexes them, mines wrong-turn corrections, and feeds those
recoveries back into future runs so each session wastes less time and fewer
tokens than the last.

## Why this exists

Every coding agent session starts from zero. If the agent hits `pytest:
command not found`, spends 4 steps figuring out it needs a venv, and eventually
succeeds — the next session on the same project will repeat the exact same
detour.

Happy Paths remembers what worked and intervenes at the moment of failure,
before the agent wastes steps rediscovering the fix.

## Where it helps (and where it doesn't)

We ran 17 benchmark iterations (~800+ runs across two benchmark suites) to
find the right intervention designs. Honest findings:

**Where it helps**: projects with undocumented setup steps, internal CLI tools,
or error messages that point the wrong way. These are the cases where a model
has no prior training data and can't infer the fix from repo files alone.

**Where it also helps**: repos where agents waste tokens reinventing existing
tools. Session mining found 9,012 throwaway scripts (~2.3M wasted tokens)
across 300 sessions. A simple `AGENTS.md` tool registry eliminated this
entirely (0 heredocs, 2.8x CLI usage).

**Where it doesn't help**: well-documented projects, standard toolchain errors,
or situations where the model can figure out the fix by reading `README.md` and
exploring the repo. Modern models (gpt-5.3-codex) are surprisingly good at
`ls → find → read → execute` discovery loops.

**What actively hurts**: injecting too many hints, injecting hints too early
(before the agent has context), or injecting generic "prior failure" warnings.
More is not better — one precise hint at the right moment beats three hints
across three errors.

See [Benchmark results](#benchmark-results) below for the full data.

## How it works

Happy Paths uses Pi's `tool_result` hook to intercept errors in real time.
When a tool call returns an error matching a known pattern, Happy Paths appends
a short recovery hint to the error output before the agent sees it.

```
Agent runs `pytest tests/` → error: "pytest: command not found"
                                    ↓
            Happy Paths matches error pattern
                                    ↓
            Appends: "This project needs setup. Create a venv,
            install dev deps, check for setup scripts in the
            repo root, then use .venv/bin/pytest."
                                    ↓
            Agent follows recipe → skips 3-4 wrong turns
```

The hints are error-keyed (matched by regex on error output), not
command-keyed. This means the same hint fires regardless of which command
produced the error. Hints are deduplicated per session — each hint fires at
most once.

## The story arc

The same failure pattern repeats at every scale. It starts with one engineer
and one agent looping on avoidable dead-ends, then compounds when multiple
agents run concurrently and replay each other's mistakes. At team scale,
engineers rediscover similar fixes independently and the cost becomes org-wide.
The natural endpoint is opt-in global sharing of learned happy paths — similar
in spirit to skill exchange, but extracted and curated from real traces.

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

1. **Correctness first** — never make the agent less reliable.
2. **Precise over prolific** — one good hint beats three noisy ones.
3. **Error-time delivery** — intervene at the moment of failure, not before.
4. **Lexical/signature retrieval first** — exact and near-exact matching before
   heavier semantic techniques.
5. **No mandatory external deps** — local mode has no database or vector
   dependency.
6. **Pluggable** — adapters/backends are swappable (harness, storage, index).

## Install

```bash
# Bun (preferred)
bun install && bun run verify

# npm
npm install && npm run verify
```

## Quick start

### As a Pi extension (recommended)

```bash
# from npm
pi install npm:@continua-ai/happy-paths

# or from source
pi install git:github.com/continua-ai/happy-paths
```

That's it. Happy Paths will capture traces and inject hints automatically.

### Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `HAPPY_PATHS_TRACE_ROOT` | `~/.happy-paths/traces` | Where traces are stored |
| `HAPPY_PATHS_TRACE_SCOPE` | `personal` | `personal`, `team`, or `public` |
| `HAPPY_PATHS_MAX_SUGGESTIONS` | `3` | Max hints per session start |
| `HAPPY_PATHS_ERROR_TIME_HINTS` | `on` | Enable/disable error-time hints |
| `HAPPY_PATHS_BEFORE_AGENT_START` | `true` | Enable/disable pre-session hints |
| `HAPPY_PATHS_HINT_MODE` | `suggest` | `suggest`, `inject`, or `none` |
| `HAPPY_PATHS_SESSION_ID` | (auto) | Override session ID (for benchmarks) |

### Programmatic usage

```ts
import { createLocalLearningLoop } from "@continua-ai/happy-paths";

// Create a learning loop backed by local JSONL files
const loop = createLocalLearningLoop({ dataDir: ".happy-paths" });

// Ingest a trace event (normally done automatically by the Pi adapter)
await loop.ingest({
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  sessionId: "session-1",
  harness: "pi",
  scope: "personal",
  type: "tool_result",
  payload: {
    command: "npm test",
    output: "Error: Cannot find module 'foo'",
    isError: true,
  },
});

// Retrieve relevant past events
const hits = await loop.retrieve({ text: "cannot find module" });
```

### Rehydrate from persisted traces

```ts
import { initializeLocalLearningLoop } from "@continua-ai/happy-paths";

// Bootstraps in-memory index from on-disk JSONL traces
const { loop, bootstrap } = await initializeLocalLearningLoop({
  dataDir: ".happy-paths",
});

console.log(`Loaded ${bootstrap.eventCount} events from prior sessions`);
```

### Ship traces to a hosted endpoint

```bash
export HAPPY_PATHS_INGEST_URL=https://your-ingest-server.example.com
export HAPPY_PATHS_TEAM_ID=team_abc
export HAPPY_PATHS_TEAM_TOKEN_FILE=~/.happy-paths/team-token.txt
export HAPPY_PATHS_TRACE_ROOTS=~/.happy-paths/traces

npx @continua-ai/happy-paths ingest ship
```

## Project identity overrides

Brand-specific identifiers are centralized in `src/core/projectIdentity.ts` and
can be overridden per integration:

```ts
const loop = createLocalLearningLoop({
  projectIdentity: {
    displayName: "YourBrand",
    defaultDataDirName: ".yourbrand",
    extensionCustomType: "yourbrand",
  },
});
```

## Development

```bash
npm run verify          # lint + typecheck + test
npm run test            # unit tests only
npm run build           # compile TypeScript

# Quality gates
npm run test:wrong-turn-gate       # wrong-turn retrieval quality gate
npm run eval:wrong-turn            # wrong-turn evaluator (hit@k, MRR)
npm run eval:feasibility           # feasibility gate evaluation
npm run eval:skateboard            # skateboard E2E evaluation
```

See [docs/metrics.md](docs/metrics.md) for evaluation methodology and
[docs/feasibility-gate.md](docs/feasibility-gate.md) for the go/no-go
validation flow.

## Benchmark results

We built a [recurring-pattern benchmark](docs/recurring-pattern-benchmark.md)
to measure whether error-time hints actually save time and tokens. The
benchmark uses synthetic Python repos with intentional traps — undocumented CLI
tools, misdirecting error messages, non-standard project setup — that simulate
the kinds of knowledge gaps models can't resolve from training data alone.

### Setup

- **Model**: gpt-5.3-codex (via Pi + OpenAI Codex provider)
- **Design**: A/B — each task runs OFF (no hints) and ON (hints enabled),
  interleaved, with 3 replicates per variant
- **Metric**: wall-clock time, error count, and tool-call count per run
- **Repos**: 13 synthetic Python projects, 52 tasks, 24 unique traps
- **Trap families**: undocumented tooling, misdirecting error messages,
  non-standard test setup, format-before-lint, build target syntax,
  hallucinated tool names
- **Real sad paths**: 2 repos mined from 300 real Pi sessions (~2,275
  categorized errors across 95K tool calls)

### How we got here (13 iterations)

Finding the right hint strategy took systematic iteration. Early attempts were
net-harmful — they added overhead without reducing errors. Each iteration
isolated one variable:

| Version | Strategy | ledgerkit Δ | logparse Δ | Key lesson |
|---|---|---|---|---|
| v3 | Easy-trap hints (venv, deps) | +89% slower | — | Models handle standard errors fine — don't hint what they already know |
| v7 | Undocumented-tool hints + pre-session injection | +31% slower | +42% slower | Hints fire but pre-session overhead dominates |
| v8 | 3 separate per-error hints + pre-session | +15% slower | +27% slower | Fewer hints = less overhead, but still net-negative |
| v9 | 1 comprehensive recipe + pre-session | +1% slower | +10% slower | Single hint dramatically better than multiple |
| v10 | 1 recipe, error-time only (no pre-session) | −5% faster | +7% slower | Removing pre-session noise flips ledgerkit net-positive |
| **v11** | **Prescriptive recipe, error-time only** | **−11% faster** | **−4% faster** | **Explicit `.venv/bin/pytest` prevents model shortcuts** |
| v12 | Terse format (just the fix command) | +14% slower | −15% faster | Terse best for simple fixes, verbose for discovery |
| v13 | Adaptive format (terse/verbose per hint) | −2% faster | +89%* slower | Middle-of-road; v11 remains best general policy |

\* v13 logparse average skewed by single 596s outlier; median: −7%.

### v11 results (current)

Error-time-only mode with a prescriptive setup recipe. Key wording
change from v10: "Use `.venv/bin/pytest` (not `pytest` or `python -m
pytest`)" — this forces the model to create a venv instead of taking
shortcuts that cause additional errors.

**ledgerkit** (undocumented `./kit` CLI tool, no README):

| Variant | Avg time | Avg errors/run | Avg calls/run |
|---|---|---|---|
| OFF (no hints) | 65s | 3.2 | 17.7 |
| ON (error-time recipe) | 58s | 3.3 | 18.0 |
| **Δ** | **−11%** | **+0.1 errors** | **+0.3 calls** |

**logparse** (undocumented `./qa` CLI tool, no README):

| Variant | Avg time | Avg errors/run | Avg calls/run |
|---|---|---|---|
| OFF (no hints) | 51s | 3.4 | 15.8 |
| ON (error-time recipe) | 49s | 3.0 | 15.7 |
| **Δ** | **−4%** | **−0.4 errors** | **−0.1 calls** |

**webutil** (misdirecting error messages, session fixture timeout trap):

| Variant | Avg time | Avg errors/run | Avg calls/run |
|---|---|---|---|
| OFF (no hints) | 91s | 2.7 | 15.7 |
| ON (error-time recipe) | 92s | 2.5 | 14.8 |
| **Δ** | **+1%** | **−0.2 errors** | **−0.8 calls** |

Both ledgerkit and logparse are net-positive. Webutil is neutral on time but
reduces errors and tool calls.

### Real sad path analysis (session mining)

We mined 300 real Pi sessions (~95K tool calls) and identified 14 recurring
sad path families. The top errors agents hit repeatedly:

| Category | Real freq | In benchmark? |
|---|---|---|
| Format before lint | 533x | ✅ monobuild (new) |
| Build target syntax | 368x | ✅ monobuild (new) |
| dx preflight timeout | 329x | _(CI-specific)_ |
| Git push conflicts | 244x | _(git-specific)_ |
| Git dirty rebase | 135x | _(git-specific)_ |
| Git worktree confusion | 132x | _(git-specific)_ |
| Hallucinated tool names | 92x | ✅ toolhub (new) |
| Missing Python modules | 88x | ✅ toolhub (new) |

The 4 git-specific patterns (push conflicts, dirty rebase, worktree confusion)
and the CI timeout pattern require git/CI infrastructure in the benchmark — a
future improvement.

### Reinvention waste benchmark (new)

We discovered a second class of waste beyond error recovery: **agents writing
throwaway scripts for operations that have existing repo tools.** Mining 300
real Pi sessions revealed 9,012 inline Python heredocs (~2.3M wasted tokens),
with 55% being Linear API and GCloud boilerplate rewritten every session.

We built a separate benchmark to measure this — 3 synthetic repos
(issuetracker, opsboard, dataquery) with 12 tasks, 151-191 files each, and
existing CLI tools (`./track`, `./ops`, `jq`) buried in docs:

| Version | Files/repo | Intervention | Heredocs (36 runs) | CLI usage | Token waste |
|---|---|---|---|---|---|
| v3 (baseline) | 151-191 | None | 9 | 59 | 1,048 |
| v3 + hints | 151-191 | Tool-call hints only | 6 | 67 | 971 (−7%) |
| **v4 (registry)** | 151-191 | **AGENTS.md tool registry** | **0** | **163 (2.8x)** | **0 (−100%)** |

**The fix isn't an algorithm — it's making tools discoverable.** A 10-line
markdown table in `AGENTS.md` mapping operations → CLI commands completely
eliminated throwaway scripts and nearly tripled CLI usage. Cost: ~200 tokens
in the system prompt. Savings: ~1,000+ tokens per session.

### What the data teaches

1. **One comprehensive hint > many small hints.** When the agent hits
   `pytest: command not found`, give it the full recipe (venv + deps + check
   for setup scripts + run tests). Don't drip-feed 3 hints across 3 errors.

2. **Error-time delivery > pre-session injection.** Injecting hints before the
   agent starts (via `before_agent_start`) adds overhead even when the hints
   are relevant. The agent hasn't seen the project yet, so generic warnings
   just add noise. Error-time delivery waits until the agent has context.

3. **Don't hint what the model already knows.** gpt-5.3-codex handles
   `pip install`, venv creation, and standard toolchain errors in 1-2 steps.
   Hinting on those is net-harmful — it adds processing overhead without
   saving any steps.

4. **Be prescriptive, not advisory.** "Use `.venv/bin/pytest`" works better
   than "create a venv first" because the model can't take a shortcut —
   `.venv/bin/pytest` won't exist without the venv. Name the specific tools
   (`./kit`, `./qa`) instead of saying "check for executable files."

5. **Hints work when errors misdirect; they hurt when README already explains.**
   Toolhub has a clear README and `./th setup` — hints add noise. Ledgerkit and
   logparse have NO README and opaque error messages — hints save 4-7 steps.

6. **The value gap is narrow but real.** Happy Paths helps most when:
   - Error messages point the wrong way (e.g., "See https://internal.docs/"
     for a URL that doesn't exist)
   - The fix requires running a tool that isn't mentioned in any repo file
   - The project uses internal/proprietary tooling that the model has no
     training data for

7. **Modern models are excellent explorers.** Even with zero documentation,
   gpt-5.3-codex discovers undocumented CLI tools via
   `ls → find → read script → execute`. Hints provide a more direct path, but
   the model usually gets there on its own in 3-4 extra steps.

### Methodology notes

- All benchmark repos are synthetic (no real user data). Source:
  `scripts/build-recurring-pattern-benchmark.ts`
- Runs use `git clean -fdx` between tasks to ensure clean state
- Traces are captured per-run and analyzed post-hoc for error counts, hint
  firing, and tool-call sequences
- Full methodology: [docs/recurring-pattern-benchmark.md](docs/recurring-pattern-benchmark.md)

### Prior work: SWE-bench Lite

We also ran ~15 matrix iterations on a
[SWE-bench Lite lane](docs/swebench-lite-lane.md) (real open-source bug fixes).
Hints were consistently net-harmful there because the tasks don't share failure
modes — each bug is unique, so there's nothing useful to learn across sessions.
This confirmed that Happy Paths is specifically valuable for *recurring*
patterns, not one-off bug fixes.

## Hosted vision

The hosted direction is opt-in sharing that grows from personal → team → global
scope, with privacy controls and artifact review at each stage. Learned
recoveries can be safely published and reused at internet scale.

## Credits

Made with care by [David Petrou (@dpetrou)](https://x.com/dpetrou) and
collaborators at [Continua AI](https://continua.ai).

## License

Apache-2.0 (see `LICENSE`).
