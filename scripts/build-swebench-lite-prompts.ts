#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  type SweBenchLiteTask,
  type SweBenchLiteTaskPack,
  buildTaskPrompt,
} from "../src/benchmarks/swebenchLite.js";

function parseArgs(argv: string[]): {
  tasks: string;
  out: string;
} {
  const options = {
    tasks: ".happy-paths/benchmarks/swebench_lite_50/tasks.json",
    out: ".happy-paths/benchmarks/swebench_lite_50/prompts.jsonl",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--tasks") {
      options.tasks = String(value);
      index += 1;
      continue;
    }

    if (token === "--out") {
      options.out = String(value);
      index += 1;
    }
  }

  return options;
}

function parseTaskPack(raw: string): SweBenchLiteTaskPack {
  const parsed = JSON.parse(raw) as Partial<SweBenchLiteTaskPack>;
  if (!Array.isArray(parsed.tasks)) {
    throw new Error("invalid task pack: missing tasks array");
  }

  return {
    schemaVersion: 1,
    generatedAtUtc:
      typeof parsed.generatedAtUtc === "string"
        ? parsed.generatedAtUtc
        : new Date().toISOString(),
    source:
      parsed.source && typeof parsed.source === "object"
        ? {
            dataset:
              typeof parsed.source.dataset === "string"
                ? parsed.source.dataset
                : "unknown",
            config:
              typeof parsed.source.config === "string"
                ? parsed.source.config
                : "unknown",
            split:
              typeof parsed.source.split === "string" ? parsed.source.split : "unknown",
            offset: typeof parsed.source.offset === "number" ? parsed.source.offset : 0,
            count: typeof parsed.source.count === "number" ? parsed.source.count : 0,
            fetchedAtUtc:
              typeof parsed.source.fetchedAtUtc === "string"
                ? parsed.source.fetchedAtUtc
                : new Date().toISOString(),
            url: typeof parsed.source.url === "string" ? parsed.source.url : "",
          }
        : {
            dataset: "unknown",
            config: "unknown",
            split: "unknown",
            offset: 0,
            count: 0,
            fetchedAtUtc: new Date().toISOString(),
            url: "",
          },
    tasks: parsed.tasks as SweBenchLiteTask[],
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const tasksPath = resolve(process.cwd(), options.tasks);
  const outPath = resolve(process.cwd(), options.out);

  const taskPack = parseTaskPack(await readFile(tasksPath, "utf-8"));

  const lines = taskPack.tasks.map((task) => {
    return JSON.stringify({
      instanceId: task.instanceId,
      repo: task.repo,
      baseCommit: task.baseCommit,
      failToPass: task.failToPass,
      passToPass: task.passToPass,
      prompt: buildTaskPrompt(task),
    });
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${lines.join("\n")}\n`, "utf-8");

  console.log(
    JSON.stringify(
      {
        tasks: tasksPath,
        out: outPath,
        promptCount: lines.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
