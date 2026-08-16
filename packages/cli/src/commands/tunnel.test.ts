import { describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import type { ConnectionOfferV2 } from "@bytetrue/byspace-protocol/connection-offer";
import { runTunnelCommand } from "./tunnel.js";

const TARGET: ConnectionOfferV2 = {
  v: 2,
  serverId: "remote-daemon",
  daemonPublicKeyB64: "cHVibGljLWtleQ",
  relay: {
    endpoint: "relay.example.com:443",
    useTls: true,
  },
};

describe("runTunnelCommand", () => {
  it("keeps the forward open until termination and then closes it", async () => {
    const events: string[] = [];
    const output: string[] = [];
    const client = {
      getLastServerInfoMessage: () => ({ features: { remoteTcpForward: true } }),
      openRemoteTcpForward: vi.fn(async () => {
        events.push("open");
        return {
          requestId: "request-1",
          forwardId: "forward-1",
          localHost: "127.0.0.1",
          localPort: 49123,
          targetPort: 3000,
        };
      }),
      closeRemoteTcpForward: vi.fn(async () => {
        events.push("close");
        return { requestId: "request-2", forwardId: "forward-1" };
      }),
      close: vi.fn(async () => {
        events.push("client-close");
      }),
    };

    await runTunnelCommand("pairing-url", "3000", { localPort: "49124" }, {} as never, {
      connect: async () => client as never,
      parseOffer: () => TARGET,
      waitForStop: async () => {
        events.push("wait");
      },
      writeStdout: (message) => output.push(message),
    });

    expect(client.openRemoteTcpForward).toHaveBeenCalledWith({
      target: TARGET,
      targetPort: 3000,
      localPort: 49124,
    });
    expect(client.closeRemoteTcpForward).toHaveBeenCalledWith("forward-1");
    expect(events).toEqual(["open", "wait", "close", "client-close"]);
    expect(output.join("")).toContain("127.0.0.1:49123 -> remote-daemon:127.0.0.1:3000");
  });

  it("renders successful readiness as YAML", async () => {
    const output: string[] = [];
    const client = {
      getLastServerInfoMessage: () => ({ features: { remoteTcpForward: true } }),
      openRemoteTcpForward: async () => ({
        requestId: "request-1",
        forwardId: "forward-1",
        localHost: "127.0.0.1" as const,
        localPort: 49123,
        targetPort: 3000,
      }),
      closeRemoteTcpForward: async () => ({
        requestId: "request-2",
        forwardId: "forward-1",
      }),
      close: async () => undefined,
    };

    await runTunnelCommand("pairing-url", "3000", { format: "yaml" }, {} as never, {
      connect: async () => client as never,
      parseOffer: () => TARGET,
      waitForStop: async () => undefined,
      writeStdout: (message) => output.push(message),
    });

    expect(YAML.parse(output.join(""))).toEqual({
      forwardId: "forward-1",
      localHost: "127.0.0.1",
      localPort: 49123,
      targetServerId: "remote-daemon",
      targetPort: 3000,
    });
  });

  it("rejects invalid ports before connecting", async () => {
    const connect = vi.fn();
    await expect(
      runTunnelCommand("pairing-url", "70000", {}, {} as never, {
        connect,
        parseOffer: () => TARGET,
        waitForStop: async () => undefined,
        writeStdout: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PORT" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects zero as an exact local port before connecting", async () => {
    const connect = vi.fn();
    await expect(
      runTunnelCommand("pairing-url", "3000", { localPort: "0" }, {} as never, {
        connect,
        parseOffer: () => TARGET,
        waitForStop: async () => undefined,
        writeStdout: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PORT" });
    expect(connect).not.toHaveBeenCalled();
  });
});
