import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { FileTraceBundleStore } from "../src/ingest/fileTraceBundleStore.js";
import {
  canonicalTraceBundleKey,
  canonicalTraceBundleMetaKey,
} from "../src/ingest/keys.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const path = tempDirs.pop();
    if (!path) {
      continue;
    }
    await rm(path, { recursive: true, force: true });
  }
});

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("http ingest", () => {
  it("stores bundles and behaves idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-paths-ingest-"));
    tempDirs.push(dir);

    const store = new FileTraceBundleStore(dir);

    const raw = Buffer.from(
      '{"id":"e1","timestamp":"2026-02-09T00:00:00Z"}\n',
      "utf-8",
    );
    const contentSha256 = sha256Hex(raw);
    const bodyGzip = gzipSync(raw, { level: 9 });

    const teamId = "continua";
    const sessionId = "session-1";

    const first = await store.storeTraceBundle({
      teamId,
      sessionId,
      contentSha256,
      receivedAtUtc: "2026-02-09T00:00:00.000Z",
      bodyGzip,
      contentType: "application/x-ndjson",
      contentEncoding: "gzip",
      clientId: "host-1",
      source: "trace_store_sessions",
      schemaVersion: "1",
      userAgent: "vitest",
    });

    expect(first.duplicate).toBe(false);

    const storedKey = canonicalTraceBundleKey({
      teamId,
      sessionId,
      contentSha256,
    });
    const storedMetaKey = canonicalTraceBundleMetaKey({
      teamId,
      sessionId,
      contentSha256,
    });

    const storedBytes = await readFile(join(dir, storedKey));
    expect(storedBytes.equals(bodyGzip)).toBe(true);

    const metaRaw = await readFile(join(dir, storedMetaKey), "utf-8");
    const meta = JSON.parse(metaRaw) as { sessionId: string; contentSha256: string };
    expect(meta.sessionId).toBe(sessionId);
    expect(meta.contentSha256).toBe(contentSha256);

    const second = await store.storeTraceBundle({
      teamId,
      sessionId,
      contentSha256,
      receivedAtUtc: "2026-02-09T00:01:00.000Z",
      bodyGzip,
      contentType: "application/x-ndjson",
      contentEncoding: "gzip",
    });

    expect(second.duplicate).toBe(true);
    expect(second.storedKey).toBe(storedKey);
  });
});
