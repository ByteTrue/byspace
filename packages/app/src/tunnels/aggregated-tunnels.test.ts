import { describe, expect, it } from "vitest";
import { fetchAggregatedTunnels, type TunnelRuntime } from "./aggregated-tunnels";

type ListTunnelsResult = Awaited<
  ReturnType<TunnelRuntime["getClient"]> extends null
    ? never
    : NonNullable<ReturnType<TunnelRuntime["getClient"]>>["listTunnels"] extends (
          ...args: never[]
        ) => Promise<infer T>
      ? T
      : never
>;

function listTunnelsOf(entries: unknown[]): () => Promise<ListTunnelsResult> {
  return async () => ({ requestId: "r", entries }) as ListTunnelsResult;
}

function makeRuntime(input: {
  snapshots: Record<string, { connectionStatus: string } | null>;
  withClient?: string[];
  entries?: Record<string, Array<{ tunnelId: string }>>;
}): TunnelRuntime {
  return {
    getSnapshot: (serverId) => input.snapshots[serverId] ?? null,
    getClient: (serverId) =>
      input.withClient?.includes(serverId)
        ? { listTunnels: listTunnelsOf(input.entries?.[serverId] ?? []) }
        : null,
  };
}

const HOSTS = [{ serverId: "host-a", serverName: "Host A" }];

describe("fetchAggregatedTunnels load state", () => {
  it("does not report loaded while a host is online but has no client yet", async () => {
    // The runtime publishes the connection status and the client in separate
    // ticks, so this window is reachable. Reading it as an answer caches an
    // empty list under the settled query key (issue 076).
    const state = await fetchAggregatedTunnels({
      hosts: HOSTS,
      runtime: makeRuntime({ snapshots: { "host-a": { connectionStatus: "online" } } }),
    });

    expect(state.status).toBe("connecting");
  });

  it("does not report loaded while a host has no runtime controller yet", async () => {
    // A registry entry whose controller has not been created: getSnapshot is
    // null. Same not-yet as above.
    const state = await fetchAggregatedTunnels({
      hosts: HOSTS,
      runtime: makeRuntime({ snapshots: {} }),
    });

    expect(state.status).toBe("connecting");
  });

  it("does not report loaded while a host is connecting", async () => {
    const state = await fetchAggregatedTunnels({
      hosts: HOSTS,
      runtime: makeRuntime({ snapshots: { "host-a": { connectionStatus: "connecting" } } }),
    });

    expect(state.status).toBe("connecting");
  });

  it("loads the entries once the host is online with a client", async () => {
    const state = await fetchAggregatedTunnels({
      hosts: HOSTS,
      runtime: makeRuntime({
        snapshots: { "host-a": { connectionStatus: "online" } },
        withClient: ["host-a"],
        entries: { "host-a": [{ tunnelId: "peer:3000" }] },
      }),
    });

    expect(state).toEqual({
      status: "loaded",
      data: [{ tunnelId: "peer:3000", serverId: "host-a", serverName: "Host A" }],
    });
  });

  it("reports loaded empty when an online host genuinely has no tunnels", async () => {
    // The fix must not turn a real empty answer into a permanent spinner.
    const state = await fetchAggregatedTunnels({
      hosts: HOSTS,
      runtime: makeRuntime({
        snapshots: { "host-a": { connectionStatus: "online" } },
        withClient: ["host-a"],
      }),
    });

    expect(state).toEqual({ status: "loaded", data: [] });
  });

  it("does not report loaded when one host answers empty and another is still settling", async () => {
    // The case the e2e reproduced: d2 is online with no tunnels of its own,
    // d1 (which owns the tunnel) has not got its client yet. Answering with
    // d2's empty result caches "no tunnels" and hides d1's entry for good.
    const state = await fetchAggregatedTunnels({
      hosts: [
        { serverId: "host-a", serverName: "Host A" },
        { serverId: "host-b", serverName: "Host B" },
      ],
      runtime: {
        getSnapshot: () => ({ connectionStatus: "online" }),
        getClient: (serverId) =>
          serverId === "host-b" ? { listTunnels: listTunnelsOf([]) } : null,
      },
    });

    expect(state.status).toBe("connecting");
  });

  it("still reports loaded empty when every online host answered", async () => {
    const state = await fetchAggregatedTunnels({
      hosts: [
        { serverId: "host-a", serverName: "Host A" },
        { serverId: "host-b", serverName: "Host B" },
      ],
      runtime: {
        getSnapshot: () => ({ connectionStatus: "online" }),
        getClient: () => ({ listTunnels: listTunnelsOf([]) }),
      },
    });

    expect(state).toEqual({ status: "loaded", data: [] });
  });

  it("reports loaded empty when every host is offline", async () => {
    const state = await fetchAggregatedTunnels({
      hosts: HOSTS,
      runtime: makeRuntime({ snapshots: { "host-a": { connectionStatus: "offline" } } }),
    });

    expect(state).toEqual({ status: "loaded", data: [] });
  });
});
