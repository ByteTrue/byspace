import { describe, expect, test } from "vitest";

import { mapOmpAdvisorMessageToToolCall } from "./advisor-message.js";
import { shouldDisplayOmpCustomMessage } from "./custom-message.js";
import { OmpRpcSlashCommandSchema, OmpSessionStateSchema } from "./rpc-types.js";

describe("OMP retained runtime compatibility", () => {
  test("accepts sessions without thinkingLevel and arbitrary command sources", () => {
    expect(
      OmpSessionStateSchema.parse({
        sessionId: "session-1",
        messageCount: 0,
        queuedMessageCount: 0,
        isStreaming: false,
        isCompacting: false,
      }).thinkingLevel,
    ).toBeUndefined();
    expect(OmpRpcSlashCommandSchema.parse({ name: "review", source: "custom" })).toMatchObject({
      source: "custom",
    });
  });

  test("renders advisor notes and honors explicit hidden custom messages", () => {
    expect(
      mapOmpAdvisorMessageToToolCall(
        {
          role: "custom",
          content: "advisor fallback",
          customType: "advisor",
          details: { notes: [{ note: "Fix this", severity: "blocker", advisor: "review" }] },
        },
        "advisor fallback",
      ),
    ).toMatchObject({
      type: "tool_call",
      name: "advisor",
      detail: { text: "[blocker] [review] Fix this" },
      metadata: { blockerCount: 1 },
    });
    expect(
      shouldDisplayOmpCustomMessage({ role: "custom", content: "hidden", display: false }),
    ).toBe(false);
  });
});
