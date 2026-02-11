# SWE-bench Lite powered run artifacts

Run id: `20260211T050214Z_offset6_count20_r1_openai-codex-mini-latest`

## In-repo evidence files

- `summary.json`
- `observed_ab_report.json`
- `trajectory_outcome_report.json`
- `manifest.json`
- `SHA256SUMS.txt`

## GCS location (full provenance)

Base prefix:

- `gs://happy-paths-staging-trace-bundles/benchmarks/swebench-lite/runs/20260211T050214Z_offset6_count20_r1_openai-codex-mini-latest/`

Published objects:

- `reports/summary.json`
- `reports/observed_ab_report.json`
- `reports/trajectory_outcome_report.json`
- `manifest/manifest.json`
- `bundles/full_bundle.tgz`
- `bundles/reports_bundle.tgz`
- `checksums/SHA256SUMS.txt`
- `raw/traces/swebench_pi_traces_phase123_power20/**`
- `raw/logs/logs/**`

Notes:

- This run uses isolated per-variant trace state with seed warm-start.
- Seed traces are pruned from scored outputs in isolated mode.
- Long-horizon pairability remains sparse for this run; use `taskPairedTrajectory`
  as the primary causal OFF/ON interpretation lane.
