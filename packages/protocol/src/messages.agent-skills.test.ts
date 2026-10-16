import { describe, expect, it } from "vitest";
import {
  AgentSkillsSaveSelectionRequestSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

describe("agent skills protocol", () => {
  it("parses dotted selection requests and confirmation", () => {
    expect(
      AgentSkillsSaveSelectionRequestSchema.parse({
        type: "agent.skills.save_selection.request",
        requestId: "request-1",
        selection: { mode: "custom", skills: ["byspace"] },
        confirmedRemovals: ["byspace-loop"],
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

  it("keeps selectionSaved optional so an older daemon still parses", () => {
    const status = {
      type: "agent.skills.get_status.response",
      payload: {
        requestId: "request-4",
        state: "not-installed",
        ops: [],
        available: ["byspace"],
        installed: [],
        selection: { mode: "custom", skills: ["byspace"] },
        selectionSaved: false,
      },
    };

    expect(SessionOutboundMessageSchema.parse(status).payload).toMatchObject({
      selectionSaved: false,
    });
    const withoutField = { ...status, payload: { ...status.payload } };
    delete (withoutField.payload as { selectionSaved?: boolean }).selectionSaved;
    expect(SessionOutboundMessageSchema.safeParse(withoutField).success).toBe(true);
  });
});
