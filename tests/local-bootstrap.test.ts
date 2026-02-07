import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalLearningLoop,
  initializeLocalLearningLoop,
} from "../src/backends/local/index.js";

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

describe("local bootstrap", () => {
  it("rebuilds index and miner state from stored trace events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contilore-bootstrap-"));
    tempDirs.push(dir);

    const writerLoop = createLocalLearningLoop({ dataDir: dir });
    await writerLoop.ingest({
      id: "event-fail",
      timestamp: new Date("2026-03-01T00:00:00.000Z").toISOString(),
      sessionId: "session-bootstrap",
      harness: "pi",
      scope: "personal",
      type: "tool_result",
      payload: {
        command: "npm run test",
        output: "Error: Cannot find module x",
        isError: true,
      },
      metrics: {
        outcome: "failure",
      },
    });

    await writerLoop.ingest({
      id: "event-success",
      timestamp: new Date("2026-03-01T00:00:01.000Z").toISOString(),
      sessionId: "session-bootstrap",
      harness: "pi",
      scope: "personal",
      type: "tool_result",
      payload: {
        command: "npm run test -- --runInBand",
        output: "PASS",
        isError: false,
      },
      metrics: {
        outcome: "success",
      },
    });

    const readerLoop = createLocalLearningLoop({ dataDir: dir });

    const beforeBootstrap = await readerLoop.retrieve({
      text: "cannot find module",
      limit: 5,
    });
    expect(beforeBootstrap).toHaveLength(0);

    const bootstrap = await readerLoop.bootstrapFromStore();
    expect(bootstrap.eventCount).toBe(2);
    expect(bootstrap.documentCount).toBeGreaterThanOrEqual(2);

    const afterBootstrap = await readerLoop.retrieve({
      text: "cannot find module",
      limit: 5,
    });
    expect(afterBootstrap.length).toBeGreaterThan(0);

    const suggestions = await readerLoop.suggest({
      text: "missing module error",
      limit: 5,
    });
    expect(suggestions.length).toBeGreaterThan(0);

    const secondBootstrap = await readerLoop.bootstrapFromStore();
    expect(secondBootstrap.eventCount).toBe(0);
    expect(secondBootstrap.documentCount).toBe(0);
  });

  it("initializes local loop with bootstrap enabled by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contilore-init-bootstrap-"));
    tempDirs.push(dir);

    const writerLoop = createLocalLearningLoop({ dataDir: dir });
    await writerLoop.ingest({
      id: "seed-event",
      timestamp: new Date("2026-03-01T00:00:00.000Z").toISOString(),
      sessionId: "session-init",
      harness: "pi",
      scope: "personal",
      type: "tool_result",
      payload: {
        command: "npx eslint src",
        output: "Permission denied",
        isError: true,
      },
      metrics: {
        outcome: "failure",
      },
    });

    const initialized = await initializeLocalLearningLoop({ dataDir: dir });
    expect(initialized.bootstrap.eventCount).toBe(1);

    const hits = await initialized.loop.retrieve({
      text: "permission denied eslint",
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);

    const initializedWithoutBootstrap = await initializeLocalLearningLoop({
      dataDir: dir,
      bootstrapFromStore: false,
    });
    expect(initializedWithoutBootstrap.bootstrap.eventCount).toBe(0);
  });
});
