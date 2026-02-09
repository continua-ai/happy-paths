# HTTP trace ingest (MVP)

This document defines the **minimal** contract between:

- a local **shipper** (runs on a developer machine; batches local sessions), and
- an **ingest server** (self-hosted or SaaS; enforces a Team boundary and stores raw bundles).

Design intent:

- Keep the Pi extension **local-capture-only** (OSS-friendly; no hardwired backend).
- Centralize **raw** traces inside a single privacy domain (a **Team**) so mining +
  evaluation can use full-fidelity data.
- Require scrubbing only at **public export** boundaries.

## Terms

- **TraceEvent**: Happy Paths normalized event (`src/core/types.ts`).
- **Session file**: a JSONL file containing TraceEvent lines for a single
  `sessionId` (default local path: `<traceRoot>/sessions/<sessionId>.jsonl`).
- **Bundle**: a gzip-compressed session file.

## Bundle format

A bundle is the gzip-compressed bytes of a session JSONL file.

- Compression: gzip
- Uncompressed content type: `application/x-ndjson`
- Each line must parse as a `TraceEvent`.

The shipper computes `contentSha256` as the SHA-256 of the **uncompressed** JSONL
bytes.

## HTTP API

### Health

`GET /healthz`

- Response: `200 {"ok": true}`

### Upload bundle

`POST /v1/trace-bundles`

#### Auth

- `Authorization: Bearer <TEAM_TOKEN>`

The ingest server maps a team token to a `teamId` (multi-tenant) or uses a
single configured `teamId` (single-tenant).

#### Required headers

- `Content-Encoding: gzip`
- `Content-Type: application/x-ndjson`
- `X-Happy-Paths-Session-Id: <sessionId>`
- `X-Happy-Paths-Content-Sha256: <hex sha256 of uncompressed bytes>`

#### Optional headers

- `X-Happy-Paths-Client-Id: <stable host id>`
- `X-Happy-Paths-Source: trace_store_sessions` (future: `pi_sessions`, etc.)
- `X-Happy-Paths-Schema-Version: 1`

#### Request body

- gzip bytes for the session JSONL.

#### Response

- New upload: `201`
- Duplicate (idempotent replay): `200`

Body (both cases):

```json
{
  "accepted": true,
  "duplicate": false,
  "teamId": "continua",
  "sessionId": "...",
  "contentSha256": "...",
  "storedKey": "teams/continua/trace-bundles/v1/sessions/<sessionId>/<sha>.jsonl.gz",
  "receivedAtUtc": "2026-02-09T01:23:45Z"
}
```

Errors:

- `401` unauthorized (missing/invalid token)
- `400` invalid request (missing headers, bad path)
- `413` payload too large

## Idempotency + upload state

Idempotency key (server-side):

- `(teamId, sessionId, contentSha256)`

If the same key is uploaded again, the ingest server should respond `200` with
`duplicate: true` and must not create a second stored copy.

Shipper upload state (client-side):

- Maintain a local state file recording the last uploaded `contentSha256` per
  `(traceRoot, ingestUrl, teamId, sessionId)`.
- On each run, upload only sessions that are new or whose `contentSha256` has
  changed.

## Storage layout (canonical key)

Regardless of backend (filesystem, GCS, S3), use a stable object key:

```
teams/<teamId>/trace-bundles/v1/sessions/<sessionId>/<contentSha256>.jsonl.gz
teams/<teamId>/trace-bundles/v1/sessions/<sessionId>/<contentSha256>.meta.json
```

The `.meta.json` should contain only small metadata (received time, clientId,
contentEncoding/contentType, etc.). It must not contain raw tool output.

## Reference implementations (in this repo)

- Shipper: `scripts/ship-trace-bundles.ts`
- Self-host ingest server (filesystem-backed): `scripts/run-ingest-server.ts`

## Configuration

### Shipper

Environment variables:

- `HAPPY_PATHS_INGEST_URL` (e.g. `http://localhost:8787`)
- `HAPPY_PATHS_TEAM_ID` (optional; used for state scoping)
- `HAPPY_PATHS_TEAM_TOKEN` (required)
- `HAPPY_PATHS_TRACE_ROOTS` (comma-separated; defaults to `.happy-paths`)
- `HAPPY_PATHS_SHIPPER_STATE_PATH` (defaults to `~/.happy-paths/shipper/state.json`)

### Ingest server

Environment variables:

- `HAPPY_PATHS_INGEST_STORAGE_DIR` (defaults to `./.happy-paths-ingest-data`)
- `HAPPY_PATHS_TEAM_ID` + `HAPPY_PATHS_TEAM_TOKEN` (single-tenant)
  - OR `HAPPY_PATHS_TEAM_TOKENS_JSON` (multi-tenant)
- `HAPPY_PATHS_MAX_BODY_BYTES` (defaults to 50MB)

## Security notes

- Raw traces can contain secrets. Treat any centralized store as sensitive.
- This contract intentionally does **not** require redaction inside a Team
  privacy domain.
- Public publishing remains scrubbed (aggregate metrics + synthetic examples
  only).
