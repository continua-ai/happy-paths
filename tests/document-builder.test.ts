import { describe, expect, it } from "vitest";
import { DefaultEventDocumentBuilder } from "../src/core/documentBuilder.js";

describe("DefaultEventDocumentBuilder", () => {
  it("adds swebench metadata for swebench session IDs", () => {
    const builder = new DefaultEventDocumentBuilder();
    const docs = builder.build({
      id: "evt-1",
      timestamp: new Date().toISOString(),
      sessionId: "swebench::django__django-10914::on::r2",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        text: "ok",
      },
      metrics: {
        outcome: "success",
      },
    });

    const baseDoc = docs.find((doc) => doc.id === "evt-1:base");
    expect(baseDoc?.metadata?.swebenchInstanceId).toBe("django__django-10914");
    expect(baseDoc?.metadata?.swebenchVariant).toBe("on");
    expect(baseDoc?.metadata?.swebenchReplicate).toBe("r2");
  });

  it("does not add swebench metadata for non-swebench sessions", () => {
    const builder = new DefaultEventDocumentBuilder();
    const docs = builder.build({
      id: "evt-2",
      timestamp: new Date().toISOString(),
      sessionId: "regular-session",
      harness: "pi",
      scope: "public",
      type: "tool_result",
      payload: {
        text: "ok",
      },
      metrics: {
        outcome: "success",
      },
    });

    const baseDoc = docs.find((doc) => doc.id === "evt-2:base");
    expect(baseDoc?.metadata?.swebenchInstanceId).toBeUndefined();
    expect(baseDoc?.metadata?.swebenchVariant).toBeUndefined();
    expect(baseDoc?.metadata?.swebenchReplicate).toBeUndefined();
  });
});
