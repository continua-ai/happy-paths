import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ShipperSessionState {
  contentSha256: string;
  uploadedAtUtc: string;
}

export interface ShipperSourceState {
  schemaVersion: 1;
  type: "trace_store_sessions";
  ingestUrl: string;
  teamId: string;
  traceRoot: string;
  sessions: Record<string, ShipperSessionState>;
}

export interface ShipperState {
  schemaVersion: 1;
  updatedAtUtc: string;
  sources: Record<string, ShipperSourceState>;
}

export function makeSourceKey(params: {
  type: ShipperSourceState["type"];
  ingestUrl: string;
  teamId: string;
  traceRoot: string;
}): string {
  return `${params.type}:${params.ingestUrl}:${params.teamId}:${params.traceRoot}`;
}

export function createEmptyState(nowUtc: string): ShipperState {
  return {
    schemaVersion: 1,
    updatedAtUtc: nowUtc,
    sources: {},
  };
}

export async function loadShipperState(
  path: string,
  nowUtc: string,
): Promise<ShipperState> {
  const raw = await readFile(path, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return createEmptyState(nowUtc);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid shipper state at ${path}: not valid JSON.`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid shipper state at ${path}: expected object.`);
  }

  const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== 1) {
    throw new Error(
      `Unsupported shipper state schemaVersion ${String(schemaVersion)} at ${path}.`,
    );
  }

  const sources = (parsed as { sources?: unknown }).sources;
  if (!sources || typeof sources !== "object") {
    throw new Error(`Invalid shipper state at ${path}: missing sources.`);
  }

  return parsed as ShipperState;
}

export async function saveShipperState(
  path: string,
  state: ShipperState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}
