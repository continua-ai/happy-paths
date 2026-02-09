import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalTraceBundleKey, canonicalTraceBundleMetaKey } from "./keys.js";
import type {
  StoreTraceBundleRequest,
  StoreTraceBundleResult,
  TraceBundleStore,
} from "./traceBundleStore.js";

interface TraceBundleMetadata {
  schemaVersion: 1;
  receivedAtUtc: string;
  teamId: string;
  sessionId: string;
  contentSha256: string;
  gzipSha256: string;
  storedKey: string;
  storedMetaKey: string;
  contentType: string;
  contentEncoding: string;
  contentLengthBytes: number;
  clientId?: string;
  source?: string;
  traceSchemaVersion?: string;
  userAgent?: string;
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class FileTraceBundleStore implements TraceBundleStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async storeTraceBundle(
    request: StoreTraceBundleRequest,
  ): Promise<StoreTraceBundleResult> {
    const storedKey = canonicalTraceBundleKey({
      teamId: request.teamId,
      sessionId: request.sessionId,
      contentSha256: request.contentSha256,
    });
    const storedMetaKey = canonicalTraceBundleMetaKey({
      teamId: request.teamId,
      sessionId: request.sessionId,
      contentSha256: request.contentSha256,
    });

    const absolutePath = join(this.rootDir, storedKey);
    const absoluteMetaPath = join(this.rootDir, storedMetaKey);

    await mkdir(dirname(absolutePath), { recursive: true });

    if (await exists(absolutePath)) {
      return {
        storedKey,
        duplicate: true,
      };
    }

    const tempPath = `${absolutePath}.tmp-${randomUUID()}`;
    await writeFile(tempPath, request.bodyGzip);
    await rename(tempPath, absolutePath);

    const metadata: TraceBundleMetadata = {
      schemaVersion: 1,
      receivedAtUtc: request.receivedAtUtc,
      teamId: request.teamId,
      sessionId: request.sessionId,
      contentSha256: request.contentSha256,
      gzipSha256: sha256Hex(request.bodyGzip),
      storedKey,
      storedMetaKey,
      contentType: request.contentType,
      contentEncoding: request.contentEncoding,
      contentLengthBytes: request.bodyGzip.byteLength,
      clientId: request.clientId,
      source: request.source,
      traceSchemaVersion: request.schemaVersion,
      userAgent: request.userAgent,
    };

    await mkdir(dirname(absoluteMetaPath), { recursive: true });
    await writeFile(absoluteMetaPath, `${JSON.stringify(metadata)}\n`, "utf-8");

    return {
      storedKey,
      duplicate: false,
    };
  }
}
