# Trajectory calibration rubric (v1)

This rubric is for manual labeling of
`.happy-paths/trajectory-calibration/sample.json` rows.

Goal: calibrate the trajectory issue classifier and quantify quality with a
confusion matrix + harmful-retry metrics.

## Label fields

Each row has:

- `manualLabel.issueKind`
- `manualLabel.harmful`
- `manualLabel.notes`

Mark a row as **fully labeled** only when both `issueKind` and `harmful` are
set.

## Issue taxonomy

### `benign_probe`

Expected exploratory attempts that fail without indicating a meaningful wrong
path.

Typical signals:
- “not found” while searching docs/files,
- harmless lookup misses,
- early reconnaissance commands.

### `transient_external`

Likely external/system instability outside path quality.

Typical signals:
- timeout/connection reset,
- 429/5xx rate-limit or temporary upstream failures,
- flaky network/service behavior.

### `command_mismatch`

The command shape/flags/subcommand are wrong for the tool or version.

Typical signals:
- `unknown option`, `invalid argument`, usage output for bad flags,
- wrong CLI invocation semantics.

### `environment_mismatch`

Failure due to environment/toolchain/runtime constraints.

Typical signals:
- missing dependency/module,
- permission denied,
- executable/file not found,
- policy or runtime environment mismatch.

### `missing_context`

Failure due to absent task/repo/runtime context.

Typical signals:
- undefined variable/key/config,
- null/undefined access from missing setup/context,
- missing required input/state.

### `unknown_failure`

Insufficient evidence to confidently assign a concrete category.

Use this instead of guessing.

## Harmful mapping guidance

Default mapping:

- `benign_probe` -> `harmful=false`
- `transient_external` -> `harmful=false`
- `command_mismatch` -> `harmful=true`
- `environment_mismatch` -> `harmful=true`
- `missing_context` -> `harmful=true`
- `unknown_failure` -> `harmful=false` (unless strong evidence proves harmful)

## Labeling process

1. Read the command and first output line.
2. Use `predicted.reason` only as a hint, not ground truth.
3. Assign `manualLabel.issueKind`.
4. Assign `manualLabel.harmful` using the mapping above.
5. Add short notes when uncertain or when context outside snippet was required.

## Quality process

- Keep at least 10–20% overlap for dual-review adjudication.
- Resolve disagreements into one final label before summary generation.
- Prefer `unknown_failure` over speculative labels.

## Dual-review packet preparation

Build reviewer packets from a source sample:

```bash
npm run eval:trajectory-calibration:prepare-dual-review -- \
  --sample .happy-paths/trajectory-calibration/sample.json \
  --out-dir .happy-paths/trajectory-calibration/review-pass-1 \
  --reviewer-a reviewer_a \
  --reviewer-b reviewer_b \
  --overlap-ratio 0.2
```

Outputs:

- `review-pass-1/manifest.json`
- `review-pass-1/reviewer_a.json`
- `review-pass-1/reviewer_b.json`

Each reviewer file is a subset assignment with `manualLabel` cleared by
default for independent labeling.

After both reviewers finish their pass, adjudicate into one merged label set:

```bash
npm run eval:trajectory-calibration:adjudicate -- \
  --sample .happy-paths/trajectory-calibration/sample.json \
  --reviewer-a-file .happy-paths/trajectory-calibration/review-pass-1/reviewer_a.json \
  --reviewer-b-file .happy-paths/trajectory-calibration/review-pass-1/reviewer_b.json \
  --conflict-policy unresolved
```

This writes:

- `review-pass-1/adjudicated.json`
- `review-pass-1/adjudication-summary.json`

## Summarize calibration quality

After labeling rows, run:

```bash
npm run eval:trajectory-calibration-summary -- \
  --sample .happy-paths/trajectory-calibration/sample.json
```

Default output:

- `.happy-paths/trajectory-calibration/summary.json`

The summary includes:
- issue-kind confusion matrix,
- per-class precision/recall/F1,
- harmful binary metrics,
- abstain and judgeable-coverage stats,
- top disagreement examples for error analysis.

## Threshold tuning pass

After adjudicated labels are available, run a threshold sweep over predicted
confidence to pick an initial operating point:

```bash
npm run eval:trajectory-calibration:tune-thresholds -- \
  --sample .happy-paths/trajectory-calibration/review-pass-1/adjudicated.json \
  --min-precision 0.85 \
  --min-judgeable-coverage 0.60
```

Default output:

- `.happy-paths/trajectory-calibration/review-pass-1/threshold-tuning.json`
