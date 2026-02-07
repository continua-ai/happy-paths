import type { LearningLoop } from "./learningLoop.js";
import type { TraceScope } from "./types.js";
import {
  type SuggestionQualityGate,
  type SuggestionQualityGateResult,
  type WrongTurnEvaluationReport,
  type WrongTurnScenario,
  type WrongTurnScenarioTemplate,
  buildWrongTurnScenarioFromTemplate,
  evaluateSuggestionQualityGate,
  evaluateWrongTurnScenarios,
} from "./wrongTurnEvaluation.js";

export interface WrongTurnDataset {
  schemaVersion: 1;
  scenarios: WrongTurnScenarioTemplate[];
  qualityGate?: SuggestionQualityGate;
}

export interface BuildScenarioBatchOptions {
  harness?: string;
  scope?: TraceScope;
  sessionPrefix?: string;
  startTime?: Date;
  scenarioTimeStepMs?: number;
}

export interface WrongTurnDatasetEvaluationResult {
  report: WrongTurnEvaluationReport;
  gateResult: SuggestionQualityGateResult;
  scenarios: WrongTurnScenario[];
}

export function buildScenarioBatchFromDataset(
  dataset: WrongTurnDataset,
  options: BuildScenarioBatchOptions = {},
): WrongTurnScenario[] {
  const harness = options.harness ?? "pi";
  const scope = options.scope ?? "personal";
  const sessionPrefix = options.sessionPrefix ?? "dataset-session";
  const startTime = options.startTime ?? new Date("2026-02-01T00:00:00.000Z");
  const scenarioTimeStepMs = options.scenarioTimeStepMs ?? 60_000;

  const output: WrongTurnScenario[] = [];

  for (const [index, template] of dataset.scenarios.entries()) {
    const timestampStart = new Date(startTime.getTime() + index * scenarioTimeStepMs);
    const resolvedTemplate: WrongTurnScenarioTemplate = {
      ...template,
      captureEvents: template.captureEvents.map((event) => {
        return {
          ...event,
          harness,
          scope,
        };
      }),
    };

    output.push(
      buildWrongTurnScenarioFromTemplate(resolvedTemplate, {
        harness,
        scope,
        sessionId: `${sessionPrefix}-${index + 1}`,
        timestampStart,
        idPrefix: `${template.id}-${index + 1}`,
      }),
    );
  }

  return output;
}

export async function evaluateWrongTurnDataset(
  dataset: WrongTurnDataset,
  createLoop: () => LearningLoop,
  options: BuildScenarioBatchOptions = {},
): Promise<WrongTurnDatasetEvaluationResult> {
  const scenarios = buildScenarioBatchFromDataset(dataset, options);
  const report = await evaluateWrongTurnScenarios(scenarios, createLoop);
  const gateResult = evaluateSuggestionQualityGate(report, dataset.qualityGate ?? {});

  return {
    report,
    gateResult,
    scenarios,
  };
}
