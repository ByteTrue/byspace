import { describe, expect, it, vi } from "vitest";
import type { ConnectionOfferV2 } from "@bytetrue/byspace-protocol/connection-offer";
import {
  openPortForward,
  PortForwardServiceError,
  type PortForwardClient,
} from "./port-forward-service";

function pairingUrl(offer: ConnectionOfferV2): string {
  return `https://app.example/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
}

function createClient(input: {
  serverId: string;
  relayEnabled?: boolean;
  supported?: boolean;
  offerServerId?: string;
}) {
  const offer: ConnectionOfferV2 = {
    v: 2,
    serverId: input.offerServerId ?? input.serverId,
    daemonPublicKeyB64: `key-${input.serverId}`,
    relay: { endpoint: "relay.example:443", useTls: true },
  };
  const openRemoteTcpForward = vi.fn(async () => ({
    requestId: "request",
    forwardId: "forward-1",
    localHost: "127.0.0.1",
    localPort: 45173,
    targetPort: 5173,
  }));
  const client = {
    getDaemonPairingOffer: vi.fn(async () => ({
      requestId: "pairing",
      url: pairingUrl(offer),
      relayEnabled: input.relayEnabled ?? true,
    })),
    getLastServerInfoMessage: vi.fn(() => ({
      type: "status" as const,
      serverId: input.serverId,
      features: { remoteTcpForward: input.supported ?? true },
    })),
    openRemoteTcpForward,
    closeRemoteTcpForward: vi.fn(async () => ({ requestId: "close", closed: true })),
    subscribeConnectionStatus: vi.fn(() => () => undefined),
  } as unknown as PortForwardClient;
  return { client, openRemoteTcpForward };
}

describe("port forward service", () => {
  it("gets the target offer and opens the forward on the source daemon", async () => {
    const source = createClient({ serverId: "source" });
    const target = createClient({ serverId: "target" });
    const clients = new Map([
      ["source", source.client],
      ["target", target.client],
    ]);

    const result = await openPortForward(
      {
        sourceServerId: "source",
        targetServerId: "target",
        targetPort: 5173,
      },
      (serverId) => clients.get(serverId) ?? null,
      () => 123,
    );

    expect(source.openRemoteTcpForward).toHaveBeenCalledWith({
      target: {
        v: 2,
        serverId: "target",
        daemonPublicKeyB64: "key-target",
        relay: { endpoint: "relay.example:443", useTls: true },
      },
      targetPort: 5173,
    });
    expect(result.forward).toEqual({
      forwardId: "forward-1",
      sourceServerId: "source",
      targetServerId: "target",
      localHost: "127.0.0.1",
      localPort: 45173,
      targetPort: 5173,
      createdAt: 123,
    });
    expect(result.sourceClient).toBe(source.client);
  });

  it("rejects a target without Relay enabled", async () => {
    const source = createClient({ serverId: "source" });
    const target = createClient({ serverId: "target", relayEnabled: false });

    await expect(
      openPortForward(
        { sourceServerId: "source", targetServerId: "target", targetPort: 80 },
        (serverId) => (serverId === "source" ? source.client : target.client),
      ),
    ).rejects.toMatchObject({ code: "target-relay-disabled" });
  });

  it("rejects a pairing offer for a different target identity", async () => {
    const source = createClient({ serverId: "source" });
    const target = createClient({ serverId: "target", offerServerId: "other" });

    await expect(
      openPortForward(
        { sourceServerId: "source", targetServerId: "target", targetPort: 80 },
        (serverId) => (serverId === "source" ? source.client : target.client),
      ),
    ).rejects.toEqual(new PortForwardServiceError("invalid-target-offer"));
  });

  it("requires current forwarding support on both daemons", async () => {
    const source = createClient({ serverId: "source", supported: false });
    const target = createClient({ serverId: "target" });

    await expect(
      openPortForward(
        { sourceServerId: "source", targetServerId: "target", targetPort: 80 },
        (serverId) => (serverId === "source" ? source.client : target.client),
      ),
    ).rejects.toMatchObject({ code: "source-update-required" });
  });
});
