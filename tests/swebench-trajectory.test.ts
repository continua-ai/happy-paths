import { describe, expect, it } from "vitest";

import {
  pairSweBenchSessions,
  parseSweBenchSessionId,
  relativeReduction,
} from "../src/benchmarks/swebenchTrajectory.js";

describe("swebenchTrajectory helpers", () => {
  it("parses canonical session IDs", () => {
    const parsed = parseSweBenchSessionId("swebench::django__django-11179::off::r2");

    expect(parsed).not.toBeNull();
    expect(parsed?.instanceId).toBe("django__django-11179");
    expect(parsed?.variant).toBe("off");
    expect(parsed?.replicate).toBe("r2");
  });

  it("supports missing replicate by defaulting to r1", () => {
    const parsed = parseSweBenchSessionId("swebench::repo__1::on");

    expect(parsed).not.toBeNull();
    expect(parsed?.replicate).toBe("r1");
  });

  it("pairs by instance + replicate and reports diagnostics", () => {
    const identities = [
      parseSweBenchSessionId("swebench::repo__1::off::r1"),
      parseSweBenchSessionId("swebench::repo__1::on::r1"),
      parseSweBenchSessionId("swebench::repo__1::off::r2"),
      parseSweBenchSessionId("swebench::repo__1::on::r2"),
      parseSweBenchSessionId("swebench::repo__2::off::r1"),
      parseSweBenchSessionId("swebench::repo__2::off::R1"),
      parseSweBenchSessionId("swebench::repo__2::on::r1"),
    ].filter((value): value is NonNullable<typeof value> => value !== null);

    const paired = pairSweBenchSessions(identities);

    expect(paired.pairs).toHaveLength(3);
    expect(paired.diagnostics.pairedRunCount).toBe(3);
    expect(paired.diagnostics.pairedInstanceCount).toBe(2);
    expect(paired.diagnostics.duplicateVariantAssignments).toBe(1);
  });

  it("computes relative reductions safely", () => {
    expect(relativeReduction(10, 7)).toBeCloseTo(0.3);
    expect(relativeReduction(0, 0)).toBe(0);
    expect(relativeReduction(0, 5)).toBe(-1);
  });
});
