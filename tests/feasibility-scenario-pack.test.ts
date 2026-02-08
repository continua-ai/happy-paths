import { describe, expect, it } from "vitest";
import {
  buildWrongTurnDatasetFromTemplates,
  extractWrongTurnScenarioTemplatesFromEvents,
  extractWrongTurnScenarioTemplatesFromPiSessionRecords,
} from "../src/core/feasibilityScenarioPack.js";
import type { TraceEvent } from "../src/core/types.js";
import type { WrongTurnScenarioTemplate } from "../src/core/wrongTurnEvaluation.js";

function event(
  input: Partial<TraceEvent> & {
    type: TraceEvent["type"];
    payload: Record<string, unknown>;
  },
): TraceEvent {
  return {
    id: input.id ?? "event-id",
    timestamp: input.timestamp ?? "2026-03-01T00:00:00.000Z",
    sessionId: input.sessionId ?? "session-1",
    harness: input.harness ?? "pi",
    scope: input.scope ?? "personal",
    type: input.type,
    payload: input.payload,
    metrics: input.metrics,
    agentId: input.agentId,
    actorId: input.actorId,
    tags: input.tags,
  };
}

describe("feasibility scenario pack", () => {
  it("extracts failure->success templates from trace events", () => {
    const events: TraceEvent[] = [
      event({
        id: "f-1",
        timestamp: "2026-03-01T00:00:01.000Z",
        type: "tool_result",
        payload: {
          command: "npm run test",
          text: "Error: Cannot find module x",
          isError: true,
        },
        metrics: {
          outcome: "failure",
          latencyMs: 150,
        },
      }),
      event({
        id: "s-1",
        timestamp: "2026-03-01T00:00:03.000Z",
        type: "tool_result",
        payload: {
          command: "npm run test -- --runInBand",
          text: "PASS",
          isError: false,
        },
        metrics: {
          outcome: "success",
          latencyMs: 80,
        },
      }),
    ];

    const templates = extractWrongTurnScenarioTemplatesFromEvents(events, {
      sessionId: "my-session",
    });

    expect(templates.length).toBe(1);
    expect(templates[0]?.id).toBe("my-session-recovery-1");
    expect(templates[0]?.query.text.toLowerCase()).toContain("cannot find module");
    expect(templates[0]?.expectedPhrases).toContain("runinband");
    expect(templates[0]?.captureEvents.length).toBe(2);
  });

  it("skips same-command failure/success pairs by default", () => {
    const events: TraceEvent[] = [
      event({
        id: "f-2",
        timestamp: "2026-03-01T00:00:01.000Z",
        type: "tool_result",
        payload: {
          command: "npm run test",
          text: "temporary network failure",
          isError: true,
        },
        metrics: {
          outcome: "failure",
        },
      }),
      event({
        id: "s-2",
        timestamp: "2026-03-01T00:00:02.000Z",
        type: "tool_result",
        payload: {
          command: "npm run test",
          text: "PASS",
          isError: false,
        },
        metrics: {
          outcome: "success",
        },
      }),
    ];

    const strictTemplates = extractWrongTurnScenarioTemplatesFromEvents(events);
    expect(strictTemplates).toEqual([]);

    const relaxedTemplates = extractWrongTurnScenarioTemplatesFromEvents(events, {
      requireCommandChange: false,
    });
    expect(relaxedTemplates.length).toBe(1);
  });

  it("extracts templates from raw pi session records", () => {
    const records = [
      {
        type: "session",
        id: "pi-session-1",
        timestamp: "2026-03-01T00:00:00.000Z",
      },
      {
        type: "message",
        timestamp: "2026-03-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "bash",
              arguments: {
                command: "./pants package sophon:auto_eval_job",
              },
            },
          ],
        },
      },
      {
        type: "message",
        timestamp: "2026-03-01T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          isError: true,
          content: [
            {
              type: "text",
              text: "./pants: command not found\n\nCommand exited with code 127",
            },
          ],
        },
      },
      {
        type: "message",
        timestamp: "2026-03-01T00:00:03.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-2",
              name: "bash",
              arguments: {
                command: "pants package sophon:auto_eval_job",
              },
            },
          ],
        },
      },
      {
        type: "message",
        timestamp: "2026-03-01T00:00:04.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-2",
          toolName: "bash",
          isError: false,
          content: [
            {
              type: "text",
              text: "12:43 [INFO] Wrote dist/sophon/auto_eval_job.pex",
            },
          ],
        },
      },
    ];

    const templates = extractWrongTurnScenarioTemplatesFromPiSessionRecords(records);
    expect(templates.length).toBe(1);
    expect(templates[0]?.id).toContain("pi-session-1-recovery");
    expect(templates[0]?.query.text.toLowerCase()).toContain("command not found");
    expect(templates[0]?.expectedPhrases).toContain("pants");
  });

  it("builds dataset from templates", () => {
    const templates: WrongTurnScenarioTemplate[] = [
      {
        id: "scenario-1",
        description: "Example",
        query: {
          text: "error query",
          limit: 8,
        },
        expectedPhrases: ["chmod"],
        captureEvents: [
          {
            harness: "pi",
            scope: "personal",
            type: "tool_result",
            payload: {
              command: "a",
            },
          },
        ],
      },
    ];

    const dataset = buildWrongTurnDatasetFromTemplates(templates);
    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.scenarios.length).toBe(1);
    expect(dataset.scenarios[0]?.id).toBe("scenario-1");
  });
});
