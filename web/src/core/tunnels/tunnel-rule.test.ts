import { describe, expect, test } from "vitest";
import { establishTunnelRule, listenHostIsOpen, type TunnelEndpointClient } from "./tunnel-rule";

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

  test("the recorded rule carries both ends and the listen address", async () => {
    const source = fakeClient();
    await establishTunnelRule({
      ...rule,
      target: { serverId: "srv_laptop", publicKey: "pk_laptop", client: fakeClient().client },
      source: { serverId: "srv_vps", publicKey: "pk_vps", client: source.client },
    });
    const sync = source.calls.find((call) => call.method === "sync");
    expect(JSON.stringify(sync?.arg)).toContain("srv_laptop");
    expect(JSON.stringify(sync?.arg)).toContain("18090");
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
