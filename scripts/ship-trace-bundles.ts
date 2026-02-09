import { defaultShipperStatePath, shipTraceBundles } from "../src/ingest/shipper.js";

interface Options {
  ingestUrl: string;
  teamId: string;
  teamToken: string;
  traceRoots: string[];
  statePath: string;
  clientId?: string;
  dryRun: boolean;
  maxUploads?: number;
}

function parseArgs(argv: string[]): Options {
  const envRoots = process.env.HAPPY_PATHS_TRACE_ROOTS
    ? process.env.HAPPY_PATHS_TRACE_ROOTS.split(",").map((value) => value.trim())
    : undefined;

  const options: Options = {
    ingestUrl: process.env.HAPPY_PATHS_INGEST_URL ?? "http://localhost:8787",
    teamId: process.env.HAPPY_PATHS_TEAM_ID ?? "default",
    teamToken: process.env.HAPPY_PATHS_TEAM_TOKEN ?? "",
    traceRoots: envRoots && envRoots.length > 0 ? envRoots : [".happy-paths"],
    statePath: process.env.HAPPY_PATHS_SHIPPER_STATE_PATH ?? defaultShipperStatePath(),
    clientId: process.env.HAPPY_PATHS_CLIENT_ID,
    dryRun: false,
    maxUploads: process.env.HAPPY_PATHS_MAX_UPLOADS
      ? Number(process.env.HAPPY_PATHS_MAX_UPLOADS)
      : undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--ingest-url") {
      options.ingestUrl = argv[i + 1] ?? options.ingestUrl;
      i += 1;
      continue;
    }

    if (arg === "--team-id") {
      options.teamId = argv[i + 1] ?? options.teamId;
      i += 1;
      continue;
    }

    if (arg === "--team-token") {
      options.teamToken = argv[i + 1] ?? options.teamToken;
      i += 1;
      continue;
    }

    if (arg === "--trace-root") {
      options.traceRoots = [argv[i + 1] ?? options.traceRoots[0] ?? ".happy-paths"];
      i += 1;
      continue;
    }

    if (arg === "--trace-roots") {
      options.traceRoots = (argv[i + 1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (arg === "--state-path") {
      options.statePath = argv[i + 1] ?? options.statePath;
      i += 1;
      continue;
    }

    if (arg === "--client-id") {
      options.clientId = argv[i + 1] ?? options.clientId;
      i += 1;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--max-uploads") {
      options.maxUploads = Number(argv[i + 1]);
      i += 1;
      continue;
    }

    throw new Error(`Unknown arg: ${arg}`);
  }

  if (!options.teamToken.trim()) {
    throw new Error(
      "Missing team token. Set HAPPY_PATHS_TEAM_TOKEN or pass --team-token.",
    );
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const result = await shipTraceBundles({
    ingestUrl: options.ingestUrl,
    teamId: options.teamId,
    teamToken: options.teamToken,
    traceRoots: options.traceRoots,
    statePath: options.statePath,
    clientId: options.clientId,
    dryRun: options.dryRun,
    maxUploads: options.maxUploads,
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.failures.length > 0) {
    process.exitCode = 2;
  }
}

await main();
