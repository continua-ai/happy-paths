#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type LoopMode = "full" | "refresh" | "summary";

type Options = {
  mode: LoopMode;
  webRepoRoot: string;
  includePiSession: boolean;
  linearIssue: string | null;
  postLinear: boolean;
  summaryJsonOut: string;
  summaryMarkdownOut: string;
};

type FeasibilityRun = {
  id: string;
  scenarioCount: number;
  deltas: {
    deadEndReduction: number;
    wallTimeReduction: number;
    tokenCountReduction: number;
    recoverySuccessOn: number;
    recoverySuccessRateDrop: number;
    gatePass: boolean;
  };
};

type FeasibilityPublicEvidence = {
  generatedAtUtc: string;
  runs: FeasibilityRun[];
};

type ObservedAbReport = {
  generatedAtUtc: string;
  aggregate: {
    totalPairs: number;
    relativeRepeatedDeadEndRateReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
  };
  gateResult: {
    pass: boolean;
    failures: string[];
  };
};

type TrajectoryLaneReport = {
  episodeCount: number;
  aggregate: {
    totalPairs: number;
    relativeHarmfulRetryReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
    judgeableCoverageOn: number;
  };
  gateResult: {
    pass: boolean;
    failures: string[];
  };
};

type TrajectoryOutcomeReport = {
  generatedAtUtc: string;
  primaryLane?: string;
  aggregate: {
    totalPairs: number;
    relativeHarmfulRetryReduction: number;
    relativeWallTimeReduction: number;
    relativeTokenCountReduction: number;
    judgeableCoverageOn: number;
  };
  gateResult: {
    pass: boolean;
    failures: string[];
  };
  laneReports?: Record<string, TrajectoryLaneReport>;
};

type LoopSummary = {
  generatedAtUtc: string;
  mode: LoopMode;
  commandsRun: string[];
  feasibility: {
    generatedAtUtc: string;
    runCount: number;
    latestRunId: string;
    latestScenarioCount: number;
    latestGatePass: boolean;
    latestDeadEndReduction: number;
    latestWallTimeReduction: number;
    latestTokenCountReduction: number;
  };
  observedAb: {
    generatedAtUtc: string;
    pairCount: number;
    gatePass: boolean;
    deadEndReduction: number;
    wallTimeReduction: number;
    tokenCountReduction: number;
    failures: string[];
  };
  trajectoryOutcome: {
    generatedAtUtc: string;
    primaryLane: string;
    pairCount: number;
    gatePass: boolean;
    harmfulRetryReduction: number;
    wallTimeReduction: number;
    tokenCountReduction: number;
    judgeableCoverageOn: number;
    failures: string[];
    fullEvalPairCount: number | null;
    familyDisjointPairCount: number | null;
  };
  reportPaths: {
    feasibilityPublic: string;
    observedAb: string;
    trajectoryOutcome: string;
  };
};

type LinearIssueReference = {
  teamKey: string;
  number: number;
};

type LinearIssueNode = {
  id: string;
  identifier: string;
  url: string;
};

type LinearCommentNode = {
  id: string;
  url: string;
};

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseLoopMode(value: string): LoopMode {
  if (value === "full" || value === "refresh" || value === "summary") {
    return value;
  }
  throw new Error(`invalid --mode value: ${value}`);
}

function parseArgs(argv: string[]): Options {
  const repoRoot = process.cwd();
  const options: Options = {
    mode: "full",
    webRepoRoot: path.resolve(repoRoot, "../happy-paths-web"),
    includePiSession: true,
    linearIssue: "CON-1469",
    postLinear: false,
    summaryJsonOut: path.resolve(
      repoRoot,
      ".happy-paths/con1469-loop/latest-summary.json",
    ),
    summaryMarkdownOut: path.resolve(
      repoRoot,
      ".happy-paths/con1469-loop/latest-summary.md",
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--mode") {
      options.mode = parseLoopMode(String(value));
      index += 1;
      continue;
    }
    if (token === "--web-repo-root") {
      options.webRepoRoot = path.resolve(repoRoot, String(value));
      index += 1;
      continue;
    }
    if (token === "--include-pi-session") {
      options.includePiSession = parseBoolean(String(value));
      index += 1;
      continue;
    }
    if (token === "--linear-issue") {
      const issue = String(value).trim();
      options.linearIssue = issue ? issue : null;
      index += 1;
      continue;
    }
    if (token === "--post-linear") {
      options.postLinear = parseBoolean(String(value));
      index += 1;
      continue;
    }
    if (token === "--summary-json-out") {
      options.summaryJsonOut = path.resolve(repoRoot, String(value));
      index += 1;
      continue;
    }
    if (token === "--summary-markdown-out") {
      options.summaryMarkdownOut = path.resolve(repoRoot, String(value));
      index += 1;
    }
  }

  return options;
}

function runCommand(
  cwd: string,
  command: string,
  args: string[],
  commandsRun: string[],
): void {
  commandsRun.push([command, ...args].join(" "));
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `command failed (${result.status ?? "unknown"}): ${command} ${args.join(" ")}`,
    );
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function ensureWebRepo(pathToRepo: string): void {
  const packageJsonPath = path.join(pathToRepo, "package.json");
  const verifyScriptPath = path.join(
    pathToRepo,
    "scripts/generate_feasibility_evidence.ts",
  );

  if (!existsSync(packageJsonPath)) {
    throw new Error(`missing web repo package.json: ${packageJsonPath}`);
  }
  if (!existsSync(verifyScriptPath)) {
    throw new Error(`missing web evidence generator: ${verifyScriptPath}`);
  }
}

function parseLinearIssueKey(value: string): LinearIssueReference {
  const match = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`invalid Linear issue key: ${value}`);
  }

  return {
    teamKey: match[1],
    number: Number(match[2]),
  };
}

async function linearGraphql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear API HTTP ${response.status}: ${text}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: unknown;
  };

  if (payload.errors) {
    throw new Error(`Linear API error: ${JSON.stringify(payload.errors)}`);
  }
  if (!payload.data) {
    throw new Error("Linear API returned no data");
  }

  return payload.data;
}

async function postLinearComment(issueKey: string, body: string): Promise<string> {
  const apiKey = (process.env.LINEAR_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY is required for --post-linear true");
  }

  const issueRef = parseLinearIssueKey(issueKey);

  const issueQueryResult = await linearGraphql<{
    issues: {
      nodes: LinearIssueNode[];
    };
  }>(
    apiKey,
    `
      query($teamKey:String!, $number:Float!){
        issues(filter:{ team:{ key:{ eq:$teamKey } }, number:{ eq:$number } }, first:1){
          nodes{ id identifier url }
        }
      }
    `,
    {
      teamKey: issueRef.teamKey,
      number: issueRef.number,
    },
  );

  const issue = issueQueryResult.issues.nodes[0];
  if (!issue) {
    throw new Error(`Linear issue not found: ${issueKey}`);
  }

  const commentResult = await linearGraphql<{
    commentCreate: {
      success: boolean;
      comment: LinearCommentNode | null;
    };
  }>(
    apiKey,
    `
      mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id url }
        }
      }
    `,
    {
      input: {
        issueId: issue.id,
        body,
      },
    },
  );

  const comment = commentResult.commentCreate.comment;
  if (!comment || !commentResult.commentCreate.success) {
    throw new Error(`Linear comment create failed for ${issueKey}`);
  }

  return comment.url;
}

function formatEasternIso(utcIso: string): string {
  const date = new Date(utcIso);
  if (!Number.isFinite(date.getTime())) {
    return utcIso;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(date);

  const values = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== "literal") {
      values.set(part.type, part.value);
    }
  }

  const offsetRaw = values.get("timeZoneName") ?? "GMT+00:00";
  const offsetMatch = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(offsetRaw);
  const sign = offsetMatch ? offsetMatch[1] : "+";
  const hour = offsetMatch ? offsetMatch[2].padStart(2, "0") : "00";
  const minute = offsetMatch ? (offsetMatch[3] ?? "00").padStart(2, "0") : "00";
  const offset = `${sign}${hour}:${minute}`;

  const year = values.get("year") ?? "0000";
  const month = values.get("month") ?? "01";
  const day = values.get("day") ?? "01";
  const hourPart = values.get("hour") ?? "00";
  const minutePart = values.get("minute") ?? "00";
  const secondPart = values.get("second") ?? "00";

  return `${year}-${month}-${day}T${hourPart}:${minutePart}:${secondPart}${offset}`;
}

function formatUtcWithEastern(utcIso: string): string {
  return `${utcIso} (US/Eastern: ${formatEasternIso(utcIso)})`;
}

function buildMarkdown(summary: LoopSummary): string {
  return [
    `CON-1469 close-loop run (${summary.mode})`,
    "",
    `- generatedAtUtc: ${formatUtcWithEastern(summary.generatedAtUtc)}`,
    "",
    "Feasibility",
    `- generatedAtUtc: ${formatUtcWithEastern(summary.feasibility.generatedAtUtc)}`,
    `- runs: ${summary.feasibility.runCount}`,
    `- latest run: ${summary.feasibility.latestRunId} (${summary.feasibility.latestScenarioCount} scenarios)`,
    `- latest gate pass: ${summary.feasibility.latestGatePass}`,
    `- dead-end / wall-time / token reductions: ${summary.feasibility.latestDeadEndReduction.toFixed(3)} / ${summary.feasibility.latestWallTimeReduction.toFixed(3)} / ${summary.feasibility.latestTokenCountReduction.toFixed(3)}`,
    "",
    "Observed A/B",
    `- generatedAtUtc: ${formatUtcWithEastern(summary.observedAb.generatedAtUtc)}`,
    `- pairs: ${summary.observedAb.pairCount}`,
    `- gate pass: ${summary.observedAb.gatePass}`,
    `- dead-end / wall-time / token reductions: ${summary.observedAb.deadEndReduction.toFixed(3)} / ${summary.observedAb.wallTimeReduction.toFixed(3)} / ${summary.observedAb.tokenCountReduction.toFixed(3)}`,
    summary.observedAb.failures.length > 0
      ? `- failures: ${summary.observedAb.failures.join("; ")}`
      : "- failures: none",
    "",
    "Trajectory outcome",
    `- generatedAtUtc: ${formatUtcWithEastern(summary.trajectoryOutcome.generatedAtUtc)}`,
    `- primary lane: ${summary.trajectoryOutcome.primaryLane}`,
    `- pairs (primary/full/disjoint): ${summary.trajectoryOutcome.pairCount} / ${summary.trajectoryOutcome.fullEvalPairCount ?? 0} / ${summary.trajectoryOutcome.familyDisjointPairCount ?? 0}`,
    `- gate pass: ${summary.trajectoryOutcome.gatePass}`,
    `- harmful-retry / wall-time / token reductions: ${summary.trajectoryOutcome.harmfulRetryReduction.toFixed(3)} / ${summary.trajectoryOutcome.wallTimeReduction.toFixed(3)} / ${summary.trajectoryOutcome.tokenCountReduction.toFixed(3)}`,
    `- judgeable coverage on: ${summary.trajectoryOutcome.judgeableCoverageOn.toFixed(3)}`,
    summary.trajectoryOutcome.failures.length > 0
      ? `- failures: ${summary.trajectoryOutcome.failures.join("; ")}`
      : "- failures: none",
    "",
    "Commands",
    ...summary.commandsRun.map((entry) => `- ${entry}`),
    "",
  ].join("\n");
}

function collectSummary(
  feasibility: FeasibilityPublicEvidence,
  observedAb: ObservedAbReport,
  trajectory: TrajectoryOutcomeReport,
  commandsRun: string[],
  reportPaths: LoopSummary["reportPaths"],
): LoopSummary {
  const latestRun = feasibility.runs[feasibility.runs.length - 1];
  if (!latestRun) {
    throw new Error("feasibility public evidence has no runs");
  }

  const primaryLane = trajectory.primaryLane ?? "full_eval";
  const fullLane = trajectory.laneReports?.full_eval;
  const familyDisjointLane = trajectory.laneReports?.family_disjoint_eval;

  return {
    generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    mode: "summary",
    commandsRun,
    feasibility: {
      generatedAtUtc: feasibility.generatedAtUtc,
      runCount: feasibility.runs.length,
      latestRunId: latestRun.id,
      latestScenarioCount: latestRun.scenarioCount,
      latestGatePass: latestRun.deltas.gatePass,
      latestDeadEndReduction: latestRun.deltas.deadEndReduction,
      latestWallTimeReduction: latestRun.deltas.wallTimeReduction,
      latestTokenCountReduction: latestRun.deltas.tokenCountReduction,
    },
    observedAb: {
      generatedAtUtc: observedAb.generatedAtUtc,
      pairCount: observedAb.aggregate.totalPairs,
      gatePass: observedAb.gateResult.pass,
      deadEndReduction: observedAb.aggregate.relativeRepeatedDeadEndRateReduction,
      wallTimeReduction: observedAb.aggregate.relativeWallTimeReduction,
      tokenCountReduction: observedAb.aggregate.relativeTokenCountReduction,
      failures: observedAb.gateResult.failures,
    },
    trajectoryOutcome: {
      generatedAtUtc: trajectory.generatedAtUtc,
      primaryLane,
      pairCount: trajectory.aggregate.totalPairs,
      gatePass: trajectory.gateResult.pass,
      harmfulRetryReduction: trajectory.aggregate.relativeHarmfulRetryReduction,
      wallTimeReduction: trajectory.aggregate.relativeWallTimeReduction,
      tokenCountReduction: trajectory.aggregate.relativeTokenCountReduction,
      judgeableCoverageOn: trajectory.aggregate.judgeableCoverageOn,
      failures: trajectory.gateResult.failures,
      fullEvalPairCount: fullLane?.aggregate.totalPairs ?? null,
      familyDisjointPairCount: familyDisjointLane?.aggregate.totalPairs ?? null,
    },
    reportPaths,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  ensureWebRepo(options.webRepoRoot);

  const commandsRun: string[] = [];

  if (options.mode === "full") {
    runCommand(repoRoot, "npm", ["run", "verify:ci"], commandsRun);
  }

  if (options.mode === "full" || options.mode === "refresh") {
    runCommand(
      repoRoot,
      "npm",
      [
        "run",
        "sync:evidence-web",
        "--",
        "--web-repo-root",
        options.webRepoRoot,
        "--include-pi-session",
        String(options.includePiSession),
      ],
      commandsRun,
    );

    runCommand(options.webRepoRoot, "npm", ["run", "verify"], commandsRun);
  }

  const reportPaths: LoopSummary["reportPaths"] = {
    feasibilityPublic: path.join(
      options.webRepoRoot,
      "public/evidence/feasibility-runs.json",
    ),
    observedAb: path.join(options.webRepoRoot, "evidence/observed_ab/report.json"),
    trajectoryOutcome: path.join(
      options.webRepoRoot,
      "evidence/trajectory_outcome/report.json",
    ),
  };

  const feasibility = await readJsonFile<FeasibilityPublicEvidence>(
    reportPaths.feasibilityPublic,
  );
  const observedAb = await readJsonFile<ObservedAbReport>(reportPaths.observedAb);
  const trajectory = await readJsonFile<TrajectoryOutcomeReport>(
    reportPaths.trajectoryOutcome,
  );

  const summary = collectSummary(
    feasibility,
    observedAb,
    trajectory,
    commandsRun,
    reportPaths,
  );
  summary.mode = options.mode;

  await mkdir(path.dirname(options.summaryJsonOut), { recursive: true });
  await writeFile(
    options.summaryJsonOut,
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf-8",
  );

  await mkdir(path.dirname(options.summaryMarkdownOut), { recursive: true });
  const markdown = buildMarkdown(summary);
  await writeFile(options.summaryMarkdownOut, `${markdown}\n`, "utf-8");

  let linearCommentUrl: string | null = null;
  if (options.postLinear) {
    if (!options.linearIssue) {
      throw new Error("--post-linear true requires --linear-issue");
    }
    linearCommentUrl = await postLinearComment(options.linearIssue, markdown);
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        summaryJsonOut: options.summaryJsonOut,
        summaryMarkdownOut: options.summaryMarkdownOut,
        linearIssue: options.linearIssue,
        linearCommentUrl,
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
