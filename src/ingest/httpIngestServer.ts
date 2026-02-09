import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TeamAuth } from "./teamAuth.js";
import type { TraceBundleStore } from "./traceBundleStore.js";

export interface IngestServerOptions {
  auth: TeamAuth;
  store: TraceBundleStore;
  maxBodyBytes?: number;
}

interface TraceBundleRequestHeaders {
  sessionId: string;
  contentSha256: string;
  clientId?: string;
  source?: string;
  schemaVersion?: string;
  userAgent?: string;
  contentType: string;
  contentEncoding: string;
}

interface TraceBundleUploadResponseV1 {
  accepted: true;
  duplicate: boolean;
  teamId: string;
  sessionId: string;
  contentSha256: string;
  storedKey: string;
  receivedAtUtc: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(payload);
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const raw = request.headers[name.toLowerCase()];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return undefined;
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = headerValue(request, name);
  if (!value || !value.trim()) {
    throw new Error(`Missing required header: ${name}`);
  }
  return value.trim();
}

async function readBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;

    if (total > maxBodyBytes) {
      const error = new Error("Payload too large");
      (error as { statusCode?: number }).statusCode = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function parseTraceBundleHeaders(request: IncomingMessage): TraceBundleRequestHeaders {
  const sessionId = requiredHeader(request, "x-happy-paths-session-id");
  const contentSha256 = requiredHeader(
    request,
    "x-happy-paths-content-sha256",
  ).toLowerCase();

  const contentType = requiredHeader(request, "content-type");
  const contentEncoding = requiredHeader(request, "content-encoding");

  return {
    sessionId,
    contentSha256,
    contentType,
    contentEncoding,
    clientId: headerValue(request, "x-happy-paths-client-id"),
    source: headerValue(request, "x-happy-paths-source"),
    schemaVersion: headerValue(request, "x-happy-paths-schema-version"),
    userAgent: headerValue(request, "user-agent"),
  };
}

export function createHttpIngestServer(options: IngestServerOptions) {
  const maxBodyBytes = options.maxBodyBytes ?? 50 * 1024 * 1024;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/healthz") {
        json(response, 200, { ok: true });
        return;
      }

      if (request.method !== "POST" || url.pathname !== "/v1/trace-bundles") {
        json(response, 404, { error: "not_found" });
        return;
      }

      const authorization = headerValue(request, "authorization");
      const tokenMatch = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
      const token = tokenMatch?.[1]?.trim();
      if (!token) {
        json(response, 401, { error: "unauthorized" });
        return;
      }

      const teamId = options.auth.resolveTeamId(token);
      if (!teamId) {
        json(response, 401, { error: "unauthorized" });
        return;
      }

      const headers = parseTraceBundleHeaders(request);
      if (!/^gzip$/i.test(headers.contentEncoding)) {
        json(response, 400, {
          error: "invalid_request",
          message: "Content-Encoding must be gzip",
        });
        return;
      }

      const bodyGzip = await readBody(request, maxBodyBytes);
      const receivedAtUtc = nowIso();

      const result = await options.store.storeTraceBundle({
        teamId,
        sessionId: headers.sessionId,
        contentSha256: headers.contentSha256,
        receivedAtUtc,
        bodyGzip,
        contentType: headers.contentType,
        contentEncoding: headers.contentEncoding,
        clientId: headers.clientId,
        source: headers.source,
        schemaVersion: headers.schemaVersion,
        userAgent: headers.userAgent,
      });

      const responseBody: TraceBundleUploadResponseV1 = {
        accepted: true,
        duplicate: result.duplicate,
        teamId,
        sessionId: headers.sessionId,
        contentSha256: headers.contentSha256,
        storedKey: result.storedKey,
        receivedAtUtc,
      };

      json(response, result.duplicate ? 200 : 201, responseBody);
    } catch (error) {
      const statusCode =
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 400;

      json(response, statusCode, {
        error: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
