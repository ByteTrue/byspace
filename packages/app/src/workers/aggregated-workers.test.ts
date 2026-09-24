/**
 * Tests for aggregated worker loading.
 *
 * The screen's states are decided here, so these cover the distinctions the UI
 * depends on: connecting versus loaded, and a host that has no workers versus a
 * host that refused the request. Collapsing the last pair would render a
 * protocol mismatch as an empty roster.
 */
import { describe, expect, it, vi } from "vitest";

import { fetchAggregatedWorkers, type WorkerRuntime } from "./aggregated-workers";

function runtimeWith(input: {
  statuses: Record<string, string>;
  workers?: Record<string, unknown[]>;
  templates?: Record<string, unknown[]>;
  failHosts?: string[];
}): WorkerRuntime {
  return {
    getSnapshot: (serverId: string) => {
      const status = input.statuses[serverId];
      return status ? { connectionStatus: status } : null;
    },
    getClient: (serverId: string) => {
      if (input.statuses[serverId] !== "online") return null;
      if (input.failHosts?.includes(serverId)) {
        return {
          listWorkers: async () => {
            throw new Error("worker_request_failed");
          },
          listWorkerTemplates: async () => {
            throw new Error("worker_request_failed");
          },
        };
      }
      return {
        listWorkers: async () => ({ workers: input.workers?.[serverId] ?? [] }),
        listWorkerTemplates: async () => ({ templates: input.templates?.[serverId] ?? [] }),
      } as never;
    },
  } as WorkerRuntime;
}

const HOST_A = { serverId: "srv_a", serverName: "Alpha" };
const HOST_B = { serverId: "srv_b", serverName: "Beta" };

const WORKER = {
  id: "wkr_1",
  name: "Alice",
  templateId: "frontend-developer",
  status: "online" as const,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

const TEMPLATE = { id: "frontend-developer", title: "Frontend Developer", skills: ["a", "b"] };

describe("fetchAggregatedWorkers", () => {
  it("reports connecting while no host is online", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: runtimeWith({ statuses: { srv_a: "connecting" } }),
    });
    expect(state.status).toBe("connecting");
  });

  it("reports connecting when a host has no snapshot at all", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: runtimeWith({ statuses: {} }),
    });
    expect(state.status).toBe("connecting");
  });

  it("loads an empty roster once a host is online", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: runtimeWith({ statuses: { srv_a: "online" } }),
    });
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.workers).toEqual([]);
    expect(state.hostErrors).toEqual([]);
  });

  it("tags workers with the host they came from", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A, HOST_B],
      runtime: runtimeWith({
        statuses: { srv_a: "online", srv_b: "online" },
        workers: { srv_a: [WORKER], srv_b: [{ ...WORKER, id: "wkr_2", name: "Bob" }] },
      }),
    });
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.workers.map((worker) => `${worker.serverId}:${worker.id}`)).toEqual([
      "srv_a:wkr_1",
      "srv_b:wkr_2",
    ]);
  });

  it("resolves the role title from the host's own catalog", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: runtimeWith({
        statuses: { srv_a: "online" },
        workers: { srv_a: [WORKER] },
        templates: { srv_a: [TEMPLATE] },
      }),
    });
    if (state.status !== "loaded") throw new Error("expected loaded");
    expect(state.workers[0]!.templateTitle).toBe("Frontend Developer");
    expect(state.templates.map((template) => template.id)).toEqual(["frontend-developer"]);
  });

  it("leaves the title null when the host no longer ships the role", async () => {
    // A worker whose role was retired is still real; the row falls back to the
    // id rather than pretending the worker has no role.
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: runtimeWith({ statuses: { srv_a: "online" }, workers: { srv_a: [WORKER] } }),
    });
    if (state.status !== "loaded") throw new Error("expected loaded");
    expect(state.workers[0]!.templateTitle).toBeNull();
  });

  it("reports a refusing host as a host error, not as an empty roster", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: runtimeWith({ statuses: { srv_a: "online" }, failHosts: ["srv_a"] }),
    });
    if (state.status !== "loaded") throw new Error("expected loaded");
    expect(state.hostErrors).toHaveLength(1);
    expect(state.hostErrors[0]).toMatchObject({ serverId: "srv_a", serverName: "Alpha" });
    expect(state.workers).toEqual([]);
  });

  it("keeps results from a healthy host when another host refuses", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A, HOST_B],
      runtime: runtimeWith({
        statuses: { srv_a: "online", srv_b: "online" },
        workers: { srv_a: [WORKER] },
        failHosts: ["srv_b"],
      }),
    });
    if (state.status !== "loaded") throw new Error("expected loaded");
    expect(state.workers.map((worker) => worker.id)).toEqual(["wkr_1"]);
    expect(state.hostErrors.map((error) => error.serverId)).toEqual(["srv_b"]);
  });

  it("does not ask an offline host for anything", async () => {
    const listWorkers = vi.fn();
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: {
        getSnapshot: () => ({ connectionStatus: "offline" }),
        getClient: () => ({ listWorkers, listWorkerTemplates: vi.fn() }) as never,
      } as WorkerRuntime,
    });
    expect(listWorkers).not.toHaveBeenCalled();
    // A host that is offline is not \"still connecting\". Reporting it that way
    // left the screen spinning forever, because nothing would ever change the
    // answer once the host was gone.
    expect(state.status).toBe("loaded");
  });

  it("reports a host that errored as loaded rather than as connecting", async () => {
    const state = await fetchAggregatedWorkers({
      hosts: [HOST_A],
      runtime: runtimeWith({ statuses: { srv_a: "error" } }),
    });
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.workers).toEqual([]);
  });
});
