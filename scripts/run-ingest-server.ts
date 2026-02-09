import { FileTraceBundleStore } from "../src/ingest/fileTraceBundleStore.js";
import { createHttpIngestServer } from "../src/ingest/httpIngestServer.js";
import { loadTeamAuthFromEnv } from "../src/ingest/teamAuth.js";

interface Options {
  port: number;
  host: string;
  storageDir: string;
  maxBodyBytes: number;
}

function parseArgs(argv: string[]): Options {
  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const options: Options = {
    port: Number.isFinite(envPort) ? (envPort as number) : 8787,
    host: "0.0.0.0",
    storageDir:
      process.env.HAPPY_PATHS_INGEST_STORAGE_DIR ?? "./.happy-paths-ingest-data",
    maxBodyBytes: process.env.HAPPY_PATHS_MAX_BODY_BYTES
      ? Number(process.env.HAPPY_PATHS_MAX_BODY_BYTES)
      : 50 * 1024 * 1024,
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { auth, teamCount } = loadTeamAuthFromEnv(process.env);

  const store = new FileTraceBundleStore(options.storageDir);
  const server = createHttpIngestServer({
    auth,
    store,
    maxBodyBytes: options.maxBodyBytes,
  });

  server.listen(options.port, options.host, () => {
    console.log(
      JSON.stringify(
        {
          ok: true,
          listening: true,
          host: options.host,
          port: options.port,
          storageDir: options.storageDir,
          teamCount,
        },
        null,
        2,
      ),
    );
  });
}

await main();
