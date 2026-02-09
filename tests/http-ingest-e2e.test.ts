import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileTraceBundleStore } from "../src/ingest/fileTraceBundleStore.js";
import { createHttpIngestServer } from "../src/ingest/httpIngestServer.js";
import { canonicalTraceBundleKey } from "../src/ingest/keys.js";
import { shipTraceBundles } from "../src/ingest/shipper.js";
import { createSingleTeamAuth } from "../src/ingest/teamAuth.js";

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

describe("http ingest e2e", () => {
  it("ships a local trace session to an ingest server", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "happy-paths-trace-root-"));
    tempDirs.push(traceRoot);

    const ingestDir = await mkdtemp(join(tmpdir(), "happy-paths-ingest-store-"));
    tempDirs.push(ingestDir);

    const sessionsDir = join(traceRoot, "sessions");
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = "session-e2e";
    const raw = Buffer.from(
      '{"id":"e1","timestamp":"2026-02-09T00:00:00Z","sessionId":"session-e2e","harness":"pi","scope":"personal","type":"tool_result","payload":{"command":"true","output":"ok","isError":false}}\n',
      "utf-8",
    );
    const contentSha256 = sha256Hex(raw);
    await writeFile(join(sessionsDir, `${sessionId}.jsonl`), raw, "utf-8");

    const token = "test-team-token";
    const teamId = "continua";

    const store = new FileTraceBundleStore(ingestDir);
    const server = createHttpIngestServer({
      auth: createSingleTeamAuth({ teamId, token }),
      store,
      maxBodyBytes: 5 * 1024 * 1024,
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("server.address() not available");
      }

      const ingestUrl = `http://127.0.0.1:${address.port}`;
      const statePath = join(traceRoot, "shipper-state.json");

      const first = await shipTraceBundles({
        ingestUrl,
        teamId,
        teamToken: token,
        traceRoots: [traceRoot],
        statePath,
      });

      expect(first.failures).toHaveLength(0);
      expect(first.uploadedSessionCount).toBe(1);

      const storedKey = canonicalTraceBundleKey({
        teamId,
        sessionId,
        contentSha256,
      });

      const storedPath = join(ingestDir, storedKey);
      const storedRaw = await readFile(storedPath);
      expect(storedRaw.byteLength).toBeGreaterThan(0);

      const second = await shipTraceBundles({
        ingestUrl,
        teamId,
        teamToken: token,
        traceRoots: [traceRoot],
        statePath,
      });

      expect(second.failures).toHaveLength(0);
      expect(second.skippedAlreadyUploadedCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
