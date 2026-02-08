# Agent Notes

## Core principles

- Correctness first. Never trade away reliability for lower cost.
- Keep architecture modular: harness adapters and backends remain pluggable.
- Prefer lexical/signature retrieval before semantic/vector retrieval.

## Commands

- `npm run verify`
- `npm run guardrails`
- `npm run build`
- `npm run sync:evidence-web`

## File-size guardrail

- Warning: 1200 LOC
- Failure: 2000 LOC
- Script: `scripts/check-large-source-files.ts`

## Source language policy

- Authored code and scripts must be TypeScript (`.ts` / `.tsx`), not JavaScript.
- Do not add new `.js` / `.mjs` source files (generated build output under `dist/`
  is fine).

## Performance defaults

- Measure first.
- Avoid N+1 I/O.
- Bound concurrency by default.
- Avoid sleep-based polling.
