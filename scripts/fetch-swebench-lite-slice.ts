#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  type SweBenchLiteRowsResponse,
  type SweBenchLiteTask,
  type SweBenchLiteTaskPack,
  normalizeSweBenchLiteRow,
  parseSweBenchLiteFetchArgs,
} from "../src/benchmarks/swebenchLite.js";

function toRowsUrl(options: {
  dataset: string;
  config: string;
  split: string;
  offset: number;
  length: number;
}): string {
  const query = new URLSearchParams({
    dataset: options.dataset,
    config: options.config,
    split: options.split,
    offset: String(options.offset),
    length: String(options.length),
  });

  return `https://datasets-server.huggingface.co/rows?${query.toString()}`;
}

async function fetchRowsPage(options: {
  dataset: string;
  config: string;
  split: string;
  offset: number;
  length: number;
}): Promise<SweBenchLiteRowsResponse> {
  const url = toRowsUrl(options);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `failed to fetch SWE-bench rows (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  return (await response.json()) as SweBenchLiteRowsResponse;
}

async function fetchSlice(options: {
  dataset: string;
  config: string;
  split: string;
  offset: number;
  count: number;
  pageSize: number;
}): Promise<{ tasks: SweBenchLiteTask[]; lastUrl: string }> {
  const tasks: SweBenchLiteTask[] = [];
  let cursor = options.offset;
  let lastUrl = "";

  while (tasks.length < options.count) {
    const remaining = options.count - tasks.length;
    const length = Math.min(options.pageSize, remaining);

    const pageOptions = {
      dataset: options.dataset,
      config: options.config,
      split: options.split,
      offset: cursor,
      length,
    };

    const response = await fetchRowsPage(pageOptions);
    const rows = response.rows ?? [];

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      tasks.push(normalizeSweBenchLiteRow(row.row));
      if (tasks.length >= options.count) {
        break;
      }
    }

    cursor += rows.length;
    lastUrl = toRowsUrl(pageOptions);
  }

  return {
    tasks,
    lastUrl,
  };
}

async function main(): Promise<void> {
  const args = parseSweBenchLiteFetchArgs(process.argv.slice(2));
  const outPath = resolve(process.cwd(), args.out);

  const fetched = await fetchSlice({
    dataset: args.dataset,
    config: args.config,
    split: args.split,
    offset: args.offset,
    count: args.count,
    pageSize: args.pageSize,
  });

  if (fetched.tasks.length === 0) {
    throw new Error("no rows returned from SWE-bench dataset server");
  }

  const pack: SweBenchLiteTaskPack = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    source: {
      dataset: args.dataset,
      config: args.config,
      split: args.split,
      offset: args.offset,
      count: fetched.tasks.length,
      fetchedAtUtc: new Date().toISOString(),
      url: fetched.lastUrl,
    },
    tasks: fetched.tasks,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(pack, null, 2)}\n`, "utf-8");

  console.log(
    JSON.stringify(
      {
        out: outPath,
        taskCount: pack.tasks.length,
        generatedAtUtc: pack.generatedAtUtc,
        source: pack.source,
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
