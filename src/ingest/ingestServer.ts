import type { Server } from "node:http";
import { FileTraceBundleStore } from "./fileTraceBundleStore.js";
import { GcsTraceBundleStore } from "./gcsTraceBundleStore.js";
import { createHttpIngestServer } from "./httpIngestServer.js";
import { loadTeamAuthFromEnv } from "./teamAuth.js";
import type { TraceBundleStore } from "./traceBundleStore.js";

export interface IngestServerCliOptions {
  port: number;
  host: string;
  storageDir: string;
  gcsBucket?: string;
  gcsPrefix?: string;
  maxBodyBytes: number;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseIngestServerCliOptions(
  argv: string[],
  env: NodeJS.ProcessEnv,
): IngestServerCliOptions {
  const options: IngestServerCliOptions = {
    port: parseNumber(env.PORT) ?? 8787,
    host: "0.0.0.0",
    storageDir: env.HAPPY_PATHS_INGEST_STORAGE_DIR ?? "./.happy-paths-ingest-data",
    gcsBucket: env.HAPPY_PATHS_INGEST_GCS_BUCKET,
    gcsPrefix: env.HAPPY_PATHS_INGEST_GCS_PREFIX,
    maxBodyBytes: parseNumber(env.HAPPY_PATHS_MAX_BODY_BYTES) ?? 50 * 1024 * 1024,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--port") {
      options.port = Number(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--host") {
      options.host = argv[i + 1] ?? options.host;
      i += 1;
      continue;
    }

    if (arg === "--storage-dir") {
      options.storageDir = argv[i + 1] ?? options.storageDir;
      i += 1;
      continue;
    }

    if (arg === "--gcs-bucket") {
      options.gcsBucket = argv[i + 1] ?? options.gcsBucket;
      i += 1;
      continue;
    }

    if (arg === "--gcs-prefix") {
      options.gcsPrefix = argv[i + 1] ?? options.gcsPrefix;
      i += 1;
      continue;
    }

    if (arg === "--max-body-bytes") {
      options.maxBodyBytes = Number(argv[i + 1]);
      i += 1;
      continue;
    }

    throw new Error(`Unknown arg: ${arg}`);
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error(`Invalid --port: ${options.port}`);
  }

  if (!Number.isFinite(options.maxBodyBytes) || options.maxBodyBytes <= 0) {
    throw new Error(`Invalid --max-body-bytes: ${options.maxBodyBytes}`);
  }

  return options;
}

export function createTraceBundleStoreFromOptions(
  options: IngestServerCliOptions,
): TraceBundleStore {
  if (options.gcsBucket?.trim()) {
    return new GcsTraceBundleStore({
      bucket: options.gcsBucket,
      prefix: options.gcsPrefix,
    });
  }

  return new FileTraceBundleStore(options.storageDir);
}

export async function runIngestServerFromCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<Server> {
  const options = parseIngestServerCliOptions(argv, env);
  const { auth, teamCount } = loadTeamAuthFromEnv(env);

  const store = createTraceBundleStoreFromOptions(options);
  const server = createHttpIngestServer({
    auth,
    store,
    maxBodyBytes: options.maxBodyBytes,
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.on("error", reject);
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        listening: true,
        host: options.host,
        port: options.port,
        storage:
          store instanceof GcsTraceBundleStore
            ? {
                kind: "gcs",
                bucket: options.gcsBucket,
                prefix: options.gcsPrefix ?? "",
              }
            : {
                kind: "filesystem",
                dir: options.storageDir,
              },
        teamCount,
      },
      null,
      2,
    ),
  );

  return server;
}
