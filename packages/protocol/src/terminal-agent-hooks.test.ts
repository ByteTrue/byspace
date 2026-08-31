import { describe, expect, it } from "vitest";
import {
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  ServerInfoStatusPayloadSchema,
} from "./messages.js";

const baseConfig = {
  mcp: { enabled: true, injectIntoAgents: true },
  providers: {},
  metadataGeneration: { providers: [] },
};

describe("terminal agent hook provider compatibility", () => {
  it("keeps old daemon config payloads valid without provider settings", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      ...baseConfig,
      enableTerminalAgentHooks: true,
    });

    expect(parsed.enableTerminalAgentHooks).toBe(true);
    expect(parsed.terminalAgentHooks).toBeUndefined();
  });

  it("accepts partial provider-keyed settings and patches", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      ...baseConfig,
      terminalAgentHooks: { claude: true, pi: false },
    });
    const patch = MutableDaemonConfigPatchSchema.parse({
      terminalAgentHooks: { pi: true },
    });

    expect(parsed.terminalAgentHooks).toEqual({ claude: true, pi: false });
    expect(patch.terminalAgentHooks).toEqual({ pi: true });
  });

  it("keeps the provider capability optional for older daemons", () => {
    const oldServerInfo = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: {},
    });
    const newServerInfo = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: { terminalAgentHookProviders: true },
    });

    expect(oldServerInfo.features?.terminalAgentHookProviders).toBeUndefined();
    expect(newServerInfo.features?.terminalAgentHookProviders).toBe(true);
  });
});
