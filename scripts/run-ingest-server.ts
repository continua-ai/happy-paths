import { runIngestServerFromCli } from "../src/ingest/ingestServer.js";

await runIngestServerFromCli(process.argv.slice(2), process.env);
