import { describe, expect, test } from "vitest";
import {
  establishTunnelRule,
  isLoopbackListenHost,
  listenHostIsOpen,
  tunnelEndStates,
  type TunnelEndpointClient,
} from "./tunnel-rule";

function fakeClient() {
  const calls: { method: string; arg: unknown }[] = [];
  const client: TunnelEndpointClient = {
    grantTunnel: async (grant) => {
      calls.push({ method: "grant", arg: grant });
      return { ok: true };
    },
    createTunnel: async (config) => {
      calls.push({ method: "create", arg: config });
      return { ok: true };
    },
    exchangeHostSync: async (input) => {
      calls.push({ method: "sync", arg: input });
      return {};
    },
  };
  return { client, calls };
}

const rule = {
  targetPort: 3425,
  listenHost: "127.0.0.1",
  listenPort: 18090,
  label: "magpie",
};

describe("establishTunnelRule", () => {
  test("writes the grant on the target and the forward on the source, with no password", async () => {
    const target = fakeClient();
    const source = fakeClient();

    const result = await establishTunnelRule({
      ...rule,
      target: { serverId: "srv_laptop", publicKey: "pk_laptop", client: target.client },
      source: { serverId: "srv_vps", publicKey: "pk_vps", client: source.client },
    });

    expect(result.ok).toBe(true);
    expect(target.calls.map((call) => call.method)).toEqual(["grant"]);
    expect(source.calls.map((call) => call.method)).toEqual(["create", "sync"]);
    expect(JSON.stringify(source.calls)).not.toContain("password");
    expect(target.calls[0]?.arg).toMatchObject({ publicKey: "pk_vps", port: 3425 });
  });

  test("stops when the target refuses the grant, and writes nothing on the source", async () => {
    const target = fakeClient();
    target.client.grantTunnel = async () => ({ ok: false, error: "not allowed" });
    const source = fakeClient();

    const result = await establishTunnelRule({
      ...rule,
      target: { serverId: "srv_laptop", publicKey: "pk_laptop", client: target.client },
      source: { serverId: "srv_vps", publicKey: "pk_vps", client: source.client },
    });

    expect(result).toEqual({ ok: false, error: "not allowed" });
    expect(source.calls).toEqual([]);
  });

  // Loopback is the daemon default and is not sent, so an older daemon keeps its meaning.
  test("a loopback listen address is not sent to the daemon", async () => {
    const source = fakeClient();
    await establishTunnelRule({
      ...rule,
      listenHost: "127.0.0.1",
      target: { serverId: "srv_laptop", publicKey: "pk_laptop", client: fakeClient().client },
      source: { serverId: "srv_vps", publicKey: "pk_vps", client: source.client },
    });
    const create = source.calls.find((call) => call.method === "create");
    expect(JSON.stringify(create?.arg)).not.toContain("listenHost");
  });

  // Anything else is a deliberate interface choice and has to reach the manager, or the listen
  // address field in the form is describing a bind that never happens.
  test("a non-loopback listen address reaches the forward config", async () => {
    const source = fakeClient();
    const result = await establishTunnelRule({
      ...rule,
      listenHost: "172.17.0.1",
      target: { serverId: "srv_laptop", publicKey: "pk_laptop", client: fakeClient().client },
      source: { serverId: "srv_vps", publicKey: "pk_vps", client: source.client },
    });
    expect(result.ok).toBe(true);
    const create = source.calls.find((call) => call.method === "create") as {
      arg: { forwards: { listenHost?: string }[] };
    };
    expect(create.arg.forwards[0]?.listenHost).toBe("172.17.0.1");
  });
});

describe("isLoopbackListenHost", () => {
  test("recognizes the default addresses and nothing else", () => {
    expect(isLoopbackListenHost("127.0.0.1")).toBe(true);
    expect(isLoopbackListenHost("localhost")).toBe(true);
    expect(isLoopbackListenHost("  127.0.0.1  ")).toBe(true);
    expect(isLoopbackListenHost("0.0.0.0")).toBe(false);
    expect(isLoopbackListenHost("172.17.0.1")).toBe(false);
    expect(isLoopbackListenHost("::")).toBe(false);
  });
});

describe("tunnelEndStates", () => {
  test("names each end, and an unreachable daemon is offline regardless of the forward", () => {
    expect(
      tunnelEndStates({ forwardState: "connected", sourceOnline: true, targetOnline: true }),
    ).toEqual({ source: "connected", target: "reachable" });
    expect(
      tunnelEndStates({ forwardState: "connected", sourceOnline: false, targetOnline: false }),
    ).toEqual({ source: "offline", target: "offline" });
  });
});

describe("listenHostIsOpen", () => {
  test("flags the addresses that accept connections from the network", () => {
    expect(listenHostIsOpen("0.0.0.0")).toBe(true);
    expect(listenHostIsOpen("::")).toBe(true);
    expect(listenHostIsOpen("127.0.0.1")).toBe(false);
    expect(listenHostIsOpen("192.168.1.5")).toBe(false);
  });
});
