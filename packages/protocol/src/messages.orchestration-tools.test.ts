import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("orchestration tool RPC schemas", () => {
  it("accepts catalog list and tool call requests", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "orchestration.tools.list.request",
        requestId: "req-list",
        callerAgentId: "agent-1",
      }),
    ).toEqual({
      type: "orchestration.tools.list.request",
      requestId: "req-list",
      callerAgentId: "agent-1",
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "orchestration.tools.call.request",
        requestId: "req-call",
        callerAgentId: "agent-1",
        callerCwd: "/tmp/project",
        callerWorkspaceId: "workspace-1",
        toolName: "create_agent",
        input: { relationship: "subagent" },
      }),
    ).toEqual({
      type: "orchestration.tools.call.request",
      requestId: "req-call",
      callerAgentId: "agent-1",
      callerCwd: "/tmp/project",
      callerWorkspaceId: "workspace-1",
      toolName: "create_agent",
      input: { relationship: "subagent" },
    });
  });

  it("accepts structured catalog and call responses", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "orchestration.tools.list.response",
        payload: {
          requestId: "req-list",
          success: true,
          error: null,
          tools: [
            {
              name: "list_agents",
              description: "List agents",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      }),
    ).toMatchObject({ type: "orchestration.tools.list.response" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "orchestration.tools.call.response",
        payload: {
          requestId: "req-call",
          success: true,
          error: null,
          result: { agents: [] },
        },
      }),
    ).toMatchObject({ type: "orchestration.tools.call.response" });
  });
});
