import { describe, expect, it } from "vitest";
import { resolveTunnelPeerTarget, resolveTunnelPeerTargets } from "./tunnel-peer-targets";
import type { HostProfile } from "@/types/host-connection";

function host(overrides: Partial<HostProfile>): HostProfile {
  return {
    serverId: "srv_default",
    label: "Default host",
    appearance: {},
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as HostProfile;
}

describe("resolveTunnelPeerTarget", () => {
  it("builds a relay client URL and carries the pairing key", () => {
    const target = resolveTunnelPeerTarget(
      host({
        serverId: "srv_remote",
        label: "Studio",
        connections: [
          {
            id: "relay:relay.example.com:443",
            type: "relay",
            relayEndpoint: "relay.example.com:443",
            useTls: true,
            daemonPublicKeyB64: "PUBKEY",
          },
        ],
      }),
    );

    expect(target).not.toBeNull();
    expect(target?.serverId).toBe("srv_remote");
    expect(target?.label).toBe("Studio");
    expect(target?.viaRelay).toBe(true);
    expect(target?.daemonPublicKeyB64).toBe("PUBKEY");
    // URL normalizes away the default 443 port.
    expect(target?.url).toContain("wss://relay.example.com/ws");
    expect(target?.url).toContain("serverId=srv_remote");
    expect(target?.url).toContain("role=client");
  });

  it("prefers the relay connection when a host has both", () => {
    const target = resolveTunnelPeerTarget(
      host({
        connections: [
          { id: "direct:127.0.0.1:6777", type: "directTcp", endpoint: "127.0.0.1:6777" },
          {
            id: "relay:relay.example.com:443",
            type: "relay",
            relayEndpoint: "relay.example.com:443",
            useTls: true,
            daemonPublicKeyB64: "PUBKEY",
          },
        ],
      }),
    );

    expect(target?.viaRelay).toBe(true);
    expect(target?.url).toContain("relay.example.com");
  });

  it("falls back to direct TCP and carries a stored password", () => {
    const target = resolveTunnelPeerTarget(
      host({
        connections: [
          {
            id: "direct:127.0.0.1:6777",
            type: "directTcp",
            endpoint: "127.0.0.1:6777",
            password: "hunter2",
          },
        ],
      }),
    );

    expect(target?.viaRelay).toBe(false);
    expect(target?.password).toBe("hunter2");
    expect(target?.daemonPublicKeyB64).toBeUndefined();
    expect(target?.url).toBe("ws://127.0.0.1:6777/ws");
  });

  it("omits the password when the connection has none", () => {
    const target = resolveTunnelPeerTarget(
      host({
        connections: [
          { id: "direct:127.0.0.1:6777", type: "directTcp", endpoint: "127.0.0.1:6777" },
        ],
      }),
    );

    expect(target).not.toBeNull();
    expect(target?.password).toBeUndefined();
  });

  it("returns null for a host with no dialable connection", () => {
    expect(resolveTunnelPeerTarget(host({ connections: [] }))).toBeNull();
  });
});

describe("resolveTunnelPeerTargets", () => {
  it("keeps order and drops undialable hosts", () => {
    const targets = resolveTunnelPeerTargets([
      host({
        serverId: "srv_a",
        label: "A",
        connections: [{ id: "direct:a:1", type: "directTcp", endpoint: "a:1" }],
      }),
      host({ serverId: "srv_empty", label: "Empty", connections: [] }),
      host({
        serverId: "srv_b",
        label: "B",
        connections: [
          {
            id: "relay:r:443",
            type: "relay",
            relayEndpoint: "r:443",
            useTls: true,
            daemonPublicKeyB64: "KEY",
          },
        ],
      }),
    ]);

    expect(targets.map((target) => target.serverId)).toEqual(["srv_a", "srv_b"]);
  });
});
