import { describe, expect, it } from "vitest";
import { isHeartbeatOwnedByAgent } from "./index.js";

describe("heartbeat ownership", () => {
  it("accepts current agent and compatibility self targets for the same agent", () => {
    expect(isHeartbeatOwnedByAgent({ type: "agent", agentId: "agent-1" }, "agent-1")).toBe(true);
    expect(isHeartbeatOwnedByAgent({ type: "self", agentId: "agent-1" }, "agent-1")).toBe(true);
  });

  it("rejects another agent and new-agent schedules", () => {
    expect(isHeartbeatOwnedByAgent({ type: "self", agentId: "agent-2" }, "agent-1")).toBe(false);
    expect(
      isHeartbeatOwnedByAgent(
        { type: "new-agent", config: { provider: "pi", cwd: "/workspace" } },
        "agent-1",
      ),
    ).toBe(false);
  });
});
