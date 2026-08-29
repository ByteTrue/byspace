import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_CAPS } from "@bytetrue/byspace-protocol/client-capabilities";
import type { HostConnection, HostProfile } from "@/types/host-connection";

const captures = vi.hoisted(() => ({
  activeConfigs: [] as Array<Record<string, unknown>>,
  probeOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@bytetrue/byspace-client/internal/daemon-client", () => ({
  DaemonClient: function DaemonClient(config: Record<string, unknown>) {
    captures.activeConfigs.push(config);
  },
}));

vi.mock("@/utils/test-daemon-connection", () => ({
  connectToDaemon: vi.fn(async (_connection: unknown, options: Record<string, unknown>) => {
    captures.probeOptions.push(options);
    return { client: {}, serverId: "server-1", hostname: null };
  }),
}));

import { createDefaultDeps } from "./host-runtime";

const host = { serverId: "server-1" } as HostProfile;
const connection = {
  id: "direct:127.0.0.1:6777",
  type: "directTcp",
  endpoint: "127.0.0.1:6777",
  useTls: false,
} as HostConnection;

describe("host runtime default connection capabilities", () => {
  beforeEach(() => {
    captures.activeConfigs.length = 0;
    captures.probeOptions.length = 0;
  });

  it("advertises selective timeline delivery for active and probe clients", async () => {
    const deps = createDefaultDeps();

    deps.createClient({ host, connection, clientId: "client-1", runtimeGeneration: 1 });
    await deps.connectToDaemon({ host, connection });

    expect(captures.activeConfigs[0]?.capabilities).toEqual({
      [CLIENT_CAPS.selectiveAgentTimeline]: true,
    });
    expect(captures.probeOptions[0]?.capabilities).toEqual({
      [CLIENT_CAPS.selectiveAgentTimeline]: true,
    });
  });
});
