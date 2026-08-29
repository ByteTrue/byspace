import { describe, expect, it } from "vitest";
import {
  BETA_HOSTED_RELEASE,
  STABLE_HOSTED_RELEASE,
} from "@bytetrue/byspace-protocol/release-channel";
import { buildHostedAgentUrl } from "./open.js";

describe("agent open", () => {
  it("uses the hosted app for the installed release channel", () => {
    expect(buildHostedAgentUrl("0.2.0", { serverId: "host/main", agentId: "agent 1" })).toBe(
      `${STABLE_HOSTED_RELEASE.appBaseUrl}/h/host%2Fmain/agent/agent%201`,
    );
    expect(buildHostedAgentUrl("0.2.1-beta.2", { serverId: "host", agentId: "agent" })).toBe(
      `${BETA_HOSTED_RELEASE.appBaseUrl}/h/host/agent/agent`,
    );
  });

  it("encodes remote identifiers without relying on a browser on the daemon host", () => {
    expect(
      buildHostedAgentUrl("0.2.0", {
        serverId: "host/main office",
        agentId: "agent/north wing",
      }),
    ).toBe(`${STABLE_HOSTED_RELEASE.appBaseUrl}/h/host%2Fmain%20office/agent/agent%2Fnorth%20wing`);
  });
});
