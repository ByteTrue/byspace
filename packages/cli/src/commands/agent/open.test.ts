import { describe, expect, it } from "vitest";
import {
  BETA_HOSTED_RELEASE,
  STABLE_HOSTED_RELEASE,
} from "@bytetrue/byspace-protocol/release-channel";
import { buildHostedAgentUrl, openWebUrl } from "./open.js";

describe("agent open", () => {
  it("uses the hosted app for the installed release channel", () => {
    expect(buildHostedAgentUrl("0.2.0", { serverId: "host/main", agentId: "agent 1" })).toBe(
      `${STABLE_HOSTED_RELEASE.appBaseUrl}/h/host%2Fmain/agent/agent%201`,
    );
    expect(buildHostedAgentUrl("0.2.1-beta.2", { serverId: "host", agentId: "agent" })).toBe(
      `${BETA_HOSTED_RELEASE.appBaseUrl}/h/host/agent/agent`,
    );
  });

  it("passes encoded agent URLs directly to the Windows launcher", async () => {
    const url = buildHostedAgentUrl("0.2.0", {
      serverId: "host/main office",
      agentId: "agent/north wing",
    });

    await openWebUrl(url, "win32", async (file, args) => {
      expect(file).toBe("explorer.exe");
      expect(args).toEqual([
        `${STABLE_HOSTED_RELEASE.appBaseUrl}/h/host%2Fmain%20office/agent/agent%2Fnorth%20wing`,
      ]);
    });
  });

  it("reports browser launch failures without losing the URL", async () => {
    const url = "https://byspace.pages.dev/h/host/agent/agent";
    await expect(
      openWebUrl(url, "linux", async (_file, args) => {
        expect(args).toEqual([url]);
        throw new Error("launcher unavailable");
      }),
    ).rejects.toThrow("launcher unavailable");
  });
});
