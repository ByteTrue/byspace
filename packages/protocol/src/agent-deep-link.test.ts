import { describe, expect, it } from "vitest";
import { buildAgentDeepLinkRoute } from "./agent-deep-link.js";

describe("agent deep links", () => {
  it("encodes an agent target into the app's host route", () => {
    expect(buildAgentDeepLinkRoute({ serverId: "server/main", agentId: "agent 123" })).toBe(
      "/h/server%2Fmain/agent/agent%20123",
    );
  });
});
