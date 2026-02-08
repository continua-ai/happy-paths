# Engineering Practices

## Guardrails

- Keep source files small and focused.
  - Warning threshold: 1200 LOC
  - Failure threshold: 2000 LOC
- Use `scripts/check-large-source-files.ts` in CI.
- Add allowlist exceptions only for generated files and document why.

## Performance defaults

- Measure first; optimize hotspots, not cold paths.
- Avoid N+1 I/O patterns.
- Bound concurrency by default.
- Prefer event-driven flows over sleep-based polling.
- Keep high-cardinality details in logs, not metric labels.

## Correctness-first rollout

For any optimization:

1. establish baseline correctness
2. run A/B or before/after on representative tasks
3. reject changes that reduce correctness, even if cheaper/faster

## Documentation

- Add docs for new adapters/backends/miners.
- Keep README examples runnable.
- Include migration paths for breaking changes.
