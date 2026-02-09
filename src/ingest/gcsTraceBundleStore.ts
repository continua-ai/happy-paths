import { Storage } from "@google-cloud/storage";
import { canonicalTraceBundleKey, canonicalTraceBundleMetaKey } from "./keys.js";
import type {
  StoreTraceBundleRequest,
  StoreTraceBundleResult,
  TraceBundleStore,
} from "./traceBundleStore.js";

export interface GcsTraceBundleStoreOptions {
  bucket: string;
  prefix?: string;
}

interface TraceBundleMetadata {
  schemaVersion: 1;
  receivedAtUtc: string;
  teamId: string;
  sessionId: string;
  contentSha256: string;
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

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) {
    return "";
  }

  const trimmed = prefix.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (code === 412) {
    return true;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (statusCode === 412) {
    return true;
  }

  return false;
}

export class GcsTraceBundleStore implements TraceBundleStore {
  private readonly bucketName: string;
  private readonly prefix: string;
  private readonly storage: Storage;

  constructor(options: GcsTraceBundleStoreOptions) {
    this.bucketName = options.bucket;
    this.prefix = normalizePrefix(options.prefix);
    this.storage = new Storage();
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

    const bucket = this.storage.bucket(this.bucketName);
    const object = bucket.file(`${this.prefix}${storedKey}`);
    const metaObject = bucket.file(`${this.prefix}${storedMetaKey}`);

    try {
      await object.save(request.bodyGzip, {
        contentType: request.contentType,
        resumable: false,
        preconditionOpts: {
          ifGenerationMatch: 0,
        },
        metadata: {
          contentEncoding: request.contentEncoding,
        },
      });
    } catch (error) {
      if (isPreconditionFailed(error)) {
        return {
          storedKey,
          duplicate: true,
        };
      }
      throw error;
    }

    const metadata: TraceBundleMetadata = {
      schemaVersion: 1,
      receivedAtUtc: request.receivedAtUtc,
      teamId: request.teamId,
      sessionId: request.sessionId,
      contentSha256: request.contentSha256,
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

    try {
      await metaObject.save(Buffer.from(`${JSON.stringify(metadata)}\n`, "utf-8"), {
        contentType: "application/json",
        resumable: false,
        preconditionOpts: {
          ifGenerationMatch: 0,
        },
      });
    } catch (error) {
      if (isPreconditionFailed(error)) {
        // Metadata already exists; treat as a successful store.
        return {
          storedKey,
          duplicate: false,
        };
      }
      throw error;
    }

    return {
      storedKey,
      duplicate: false,
    };
  }
}
