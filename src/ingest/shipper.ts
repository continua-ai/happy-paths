import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  type ShipperSourceState,
  createEmptyState,
  loadShipperState,
  makeSourceKey,
  saveShipperState,
} from "./shipperState.js";

export interface TraceShipperOptions {
  ingestUrl: string;
  teamId: string;
  teamToken: string;
  traceRoots: string[];
  statePath: string;
  clientId?: string;
  dryRun?: boolean;
  maxUploads?: number;
}

export interface TraceShipperFailure {
  traceRoot: string;
  sessionId: string;
  path: string;
  message: string;
}

export interface TraceShipperResult {
  generatedAtUtc: string;
  ingestUrl: string;
  teamId: string;
  traceRoots: string[];
  scannedSessionCount: number;
  uploadedSessionCount: number;
  skippedAlreadyUploadedCount: number;
  failures: TraceShipperFailure[];
}

interface SessionFile {
  traceRoot: string;
  sessionId: string;
  path: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeIngestUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function expandHome(rawPath: string): string {
  if (rawPath.startsWith("~/")) {
    return join(homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function absolutizePath(rawPath: string): string {
  const expanded = expandHome(rawPath);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
}

async function findSessionFiles(traceRoot: string): Promise<SessionFile[]> {
  const rootAbs = absolutizePath(traceRoot);
  const sessionsDir = (await isDirectory(join(rootAbs, "sessions")))
    ? join(rootAbs, "sessions")
    : rootAbs;

  if (!(await isDirectory(sessionsDir))) {
    return [];
  }

  const entries = await readdir(sessionsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => {
      const sessionId = entry.name.replace(/\.jsonl$/, "");
      return {
        traceRoot: rootAbs,
        sessionId,
        path: join(sessionsDir, entry.name),
      };
    });
}

async function uploadSession(params: {
  ingestUrl: string;
  teamToken: string;
  teamId: string;
  clientId?: string;
  session: SessionFile;
  contentSha256: string;
  bodyGzip: Buffer;
}): Promise<{ duplicate: boolean }> {
  const url = `${normalizeIngestUrl(params.ingestUrl)}/v1/trace-bundles`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.teamToken}`,
      "Content-Type": "application/x-ndjson",
      "Content-Encoding": "gzip",
      "X-Happy-Paths-Session-Id": params.session.sessionId,
      "X-Happy-Paths-Content-Sha256": params.contentSha256,
      "X-Happy-Paths-Client-Id": params.clientId ?? "",
      "X-Happy-Paths-Source": "trace_store_sessions",
      "X-Happy-Paths-Schema-Version": "1",
    },
    body: params.bodyGzip,
  });

  const raw = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  const duplicate =
    !!parsed &&
    typeof parsed === "object" &&
    "duplicate" in parsed &&
    typeof (parsed as { duplicate?: unknown }).duplicate === "boolean"
      ? (parsed as { duplicate: boolean }).duplicate
      : response.status === 200;

  return { duplicate };
}

function ensureSourceState(
  sources: Record<string, ShipperSourceState>,
  sourceKey: string,
  source: Omit<ShipperSourceState, "sessions" | "schemaVersion">,
): ShipperSourceState {
  const existing = sources[sourceKey];
  if (existing) {
    return existing;
  }

  const created: ShipperSourceState = {
    schemaVersion: 1,
    type: source.type,
    ingestUrl: source.ingestUrl,
    teamId: source.teamId,
    traceRoot: source.traceRoot,
    sessions: {},
  };
  sources[sourceKey] = created;
  return created;
}

export function defaultShipperStatePath(): string {
  return join(homedir(), ".happy-paths", "shipper", "state.json");
}

export async function shipTraceBundles(
  options: TraceShipperOptions,
): Promise<TraceShipperResult> {
  const generatedAtUtc = nowIso();
  const ingestUrl = normalizeIngestUrl(options.ingestUrl);
  const traceRoots = options.traceRoots.map(absolutizePath);

  const statePath = absolutizePath(options.statePath);
  const state = await loadShipperState(statePath, generatedAtUtc);

  let scannedSessionCount = 0;
  let uploadedSessionCount = 0;
  let skippedAlreadyUploadedCount = 0;
  const failures: TraceShipperFailure[] = [];

  for (const traceRoot of traceRoots) {
    const sessions = await findSessionFiles(traceRoot);
    scannedSessionCount += sessions.length;

    const sourceKey = makeSourceKey({
      type: "trace_store_sessions",
      ingestUrl,
      teamId: options.teamId,
      traceRoot,
    });

    const sourceState = ensureSourceState(state.sources, sourceKey, {
      type: "trace_store_sessions",
      ingestUrl,
      teamId: options.teamId,
      traceRoot,
    });

    for (const session of sessions) {
      if (
        options.maxUploads !== undefined &&
        uploadedSessionCount >= options.maxUploads
      ) {
        break;
      }

      try {
        const raw = await readFile(session.path);
        const contentSha256 = sha256Hex(raw);
        const prior = sourceState.sessions[session.sessionId];
        if (prior?.contentSha256 === contentSha256) {
          skippedAlreadyUploadedCount += 1;
          continue;
        }

        if (options.dryRun) {
          uploadedSessionCount += 1;
          continue;
        }

        const bodyGzip = gzipSync(raw, { level: 9 });
        await uploadSession({
          ingestUrl,
          teamId: options.teamId,
          teamToken: options.teamToken,
          clientId: options.clientId,
          session,
          contentSha256,
          bodyGzip,
        });

        sourceState.sessions[session.sessionId] = {
          contentSha256,
          uploadedAtUtc: nowIso(),
        };
        state.updatedAtUtc = nowIso();
        await saveShipperState(statePath, state);

        uploadedSessionCount += 1;
      } catch (error) {
        failures.push({
          traceRoot,
          sessionId: session.sessionId,
          path: session.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (Object.keys(state.sources).length === 0) {
    const empty = createEmptyState(generatedAtUtc);
    await saveShipperState(statePath, empty);
  }

  return {
    generatedAtUtc,
    ingestUrl,
    teamId: options.teamId,
    traceRoots,
    scannedSessionCount,
    uploadedSessionCount,
    skippedAlreadyUploadedCount,
    failures,
  };
}
