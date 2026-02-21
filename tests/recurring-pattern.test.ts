import { describe, expect, it } from "vitest";

import {
  buildRecurringPatternPrompt,
  parseRecurringPatternSessionId,
  tasksByTrap,
  trapRecurrenceCounts,
} from "../src/benchmarks/recurringPattern.js";
import {
  ALL_TASKS,
  ALL_TEMPLATES,
  ALL_TRAPS,
  DATAPROC_TASKS,
  PYMATH_TASKS,
} from "../src/benchmarks/recurringPatternTemplates.js";

describe("recurringPattern types", () => {
  it("parses a valid session ID", () => {
    const result = parseRecurringPatternSessionId("rp::pymath-001-mean-empty::on::r2");
    expect(result).toEqual({
      sessionId: "rp::pymath-001-mean-empty::on::r2",
      prefix: "rp",
      taskId: "pymath-001-mean-empty",
      variant: "on",
      replicate: "r2",
    });
  });

  it("parses session ID with default replicate", () => {
    const result = parseRecurringPatternSessionId("rp::dataproc-001-csv-quoted::off");
    expect(result).toEqual({
      sessionId: "rp::dataproc-001-csv-quoted::off",
      prefix: "rp",
      taskId: "dataproc-001-csv-quoted",
      variant: "off",
      replicate: "r1",
    });
  });

  it("returns null for invalid prefix", () => {
    expect(parseRecurringPatternSessionId("swebench::task::on::r1")).toBeNull();
  });

  it("returns null for invalid variant", () => {
    expect(parseRecurringPatternSessionId("rp::task::maybe::r1")).toBeNull();
  });

  it("returns null for too few parts", () => {
    expect(parseRecurringPatternSessionId("rp::task")).toBeNull();
  });
});

describe("recurringPattern templates", () => {
  it("has at least 2 templates", () => {
    expect(ALL_TEMPLATES.length).toBeGreaterThanOrEqual(2);
  });

  it("has at least 8 tasks", () => {
    expect(ALL_TASKS.length).toBeGreaterThanOrEqual(8);
  });

  it("has at least 4 unique traps", () => {
    expect(ALL_TRAPS.length).toBeGreaterThanOrEqual(4);
  });

  it("every task references a valid template", () => {
    const templateIds = new Set(ALL_TEMPLATES.map((t) => t.templateId));
    for (const task of ALL_TASKS) {
      expect(templateIds.has(task.repoTemplateId)).toBe(true);
    }
  });

  it("every task references valid trap IDs", () => {
    const trapIds = new Set(ALL_TRAPS.map((t) => t.trapId));
    for (const task of ALL_TASKS) {
      for (const trapId of task.expectedTrapIds) {
        expect(trapIds.has(trapId)).toBe(true);
      }
    }
  });

  it("every task has at least one expected trap", () => {
    for (const task of ALL_TASKS) {
      expect(task.expectedTrapIds.length).toBeGreaterThan(0);
    }
  });

  it("every task has a gold patch", () => {
    for (const task of ALL_TASKS) {
      expect(Object.keys(task.goldPatch).length).toBeGreaterThan(0);
    }
  });

  it("every task has a verify command", () => {
    for (const task of ALL_TASKS) {
      expect(task.verifyCommand.length).toBeGreaterThan(0);
    }
  });
});

describe("trap recurrence", () => {
  it("missing-pytest-cov recurs across both repos", () => {
    const counts = trapRecurrenceCounts(ALL_TASKS);
    expect(counts.get("missing-pytest-cov")).toBeGreaterThanOrEqual(8);
  });

  it("broad-pytest-suite recurs across both repos", () => {
    const counts = trapRecurrenceCounts(ALL_TASKS);
    expect(counts.get("broad-pytest-suite")).toBeGreaterThanOrEqual(8);
  });

  it("missing-pyyaml recurs across dataproc tasks", () => {
    const counts = trapRecurrenceCounts(ALL_TASKS);
    expect(counts.get("missing-pyyaml")).toBeGreaterThanOrEqual(4);
  });

  it("every trap appears in at least 2 tasks", () => {
    const counts = trapRecurrenceCounts(ALL_TASKS);
    for (const [trapId, count] of counts) {
      expect(count, `trap ${trapId} should recur`).toBeGreaterThanOrEqual(2);
    }
  });

  it("tasksByTrap returns correct groupings", () => {
    const grouped = tasksByTrap(ALL_TASKS);
    const pymathTasks = grouped.get("missing-pytest-cov") ?? [];
    expect(pymathTasks).toContain("pymath-001-mean-empty");
    expect(pymathTasks).toContain("dataproc-001-csv-quoted");
  });
});

describe("buildRecurringPatternPrompt", () => {
  it("includes task ID and problem statement", () => {
    const task = PYMATH_TASKS[0];
    if (!task) {
      throw new Error("no tasks");
    }
    const prompt = buildRecurringPatternPrompt(task);
    expect(prompt).toContain(task.taskId);
    expect(prompt).toContain("mean()");
    expect(prompt).toContain(task.verifyCommand);
  });

  it("does not leak trap information", () => {
    for (const task of ALL_TASKS) {
      const prompt = buildRecurringPatternPrompt(task);
      expect(prompt).not.toContain("pytest-cov");
      expect(prompt).not.toContain("pyyaml");
      expect(prompt).not.toContain("config.yaml.example");
      expect(prompt).not.toContain("trap");
    }
  });
});

describe("template files", () => {
  it("pymath pyproject.toml includes --cov addopts (the trap)", () => {
    const pymath = ALL_TEMPLATES.find((t) => t.templateId === "pymath");
    expect(pymath).toBeDefined();
    const pyproject = pymath?.files["pyproject.toml"] ?? "";
    expect(pyproject).toContain("--cov=pymath");
  });

  it("pymath requirements.txt does NOT include pytest-cov (the trap)", () => {
    const pymath = ALL_TEMPLATES.find((t) => t.templateId === "pymath");
    expect(pymath).toBeDefined();
    const req = pymath?.files["requirements.txt"] ?? "";
    expect(req).not.toContain("pytest-cov");
  });

  it("dataproc has config.yaml.example but not config.yaml (the trap)", () => {
    const dataproc = ALL_TEMPLATES.find((t) => t.templateId === "dataproc");
    expect(dataproc).toBeDefined();
    expect(dataproc?.files["config.yaml.example"]).toBeDefined();
    expect(dataproc?.files["config.yaml"]).toBeUndefined();
  });

  it("dataproc requirements.txt does NOT include pyyaml (the trap)", () => {
    const dataproc = ALL_TEMPLATES.find((t) => t.templateId === "dataproc");
    expect(dataproc).toBeDefined();
    const req = dataproc?.files["requirements.txt"] ?? "";
    expect(req).not.toContain("pyyaml");
    expect(req).not.toContain("PyYAML");
  });

  it("every template has slow integration tests", () => {
    for (const template of ALL_TEMPLATES) {
      const hasSlowTest = Object.entries(template.files).some(([path, content]) => {
        return path.startsWith("tests/") && content.includes("@pytest.mark.slow");
      });
      expect(hasSlowTest, `${template.templateId} should have slow tests`).toBe(true);
    }
  });
});
