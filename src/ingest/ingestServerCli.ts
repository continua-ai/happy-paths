import { runIngestServerFromCli } from "./ingestServer.js";

await runIngestServerFromCli(process.argv.slice(2), process.env);
