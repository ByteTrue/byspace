import { describe, expect, it } from "vitest";
import {
  AgentSkillsSaveSelectionRequestSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("agent skills protocol", () => {
  it("parses dotted selection requests and confirmation", () => {
    expect(
      AgentSkillsSaveSelectionRequestSchema.parse({
        type: "agent.skills.save_selection.request",
        requestId: "request-1",
        selection: { mode: "custom", skills: ["byspace"] },
        confirmedRemovals: ["byspace-committee"],
      }),
    ).toMatchObject({ requestId: "request-1" });
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "agent.skills.get_status.request",
        requestId: "request-2",
      }).success,
    ).toBe(true);
  });

  it("parses status responses and keeps the capability optional", () => {
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "agent.skills.get_status.response",
        payload: {
          requestId: "request-3",
          state: "not-installed",
          ops: [{ kind: "add", name: "byspace" }],
          available: ["byspace"],
          installed: [],
          selection: { mode: "all" },
        },
      }).success,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-daemon",
        features: {},
      }).features.skillManagement,
    ).toBeUndefined();
  });
});
