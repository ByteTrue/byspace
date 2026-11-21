import { expect, test } from "vitest";
import { SessionInboundMessageSchema } from "./messages.js";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";

test("Pi background terminal list and stop use the same request", () => {
  const list = {
    type: "agent.pi.manage_background_terminal.request",
    agentId: "pi-agent",
    requestId: "req-1",
  };
  const stop = { ...list, taskId: "task-1" };
  expect(SessionInboundMessageSchema.parse(list)).toEqual(list);
  expect(SessionInboundMessageSchema.parse(stop)).toEqual(stop);
});

test("the WebSocket validator distinguishes an unavailable roster from an empty roster", () => {
  const task = {
    id: "task-1",
    command: "npm run dev",
    status: "timed_out",
  };
  function response(tasks: unknown) {
    return {
      type: "session",
      message: {
        type: "agent.pi.manage_background_terminal.response",
        payload: { requestId: "req-1", tasks, error: null },
      },
    };
  }
  for (const tasks of [null, [], [task]]) {
    const data = response(tasks);
    expect(validateWSOutboundMessage(data)).toEqual({ success: true, data });
  }
  expect(validateWSOutboundMessage(response([{ ...task, status: "unknown" }])).success).toBe(false);
});
