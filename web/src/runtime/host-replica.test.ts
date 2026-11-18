import { describe, expect, test } from "vitest";
import type { HostProfile } from "@/types/host-connection";
import {
  exchangeReplica,
  hostRecordsToProfiles,
  pushReplica,
  rememberPasswords,
  replicaDiff,
  type ReplicaClient,
  type ReplicaExchange,
} from "./host-replica";

function profile(serverId: string, password?: string): HostProfile {
  return {
    serverId,
    label: serverId,
    appearance: { color: "none", badgeDisplay: "auto" },
    lifecycle: {},
    connections: [
      {
        id: `relay:${serverId}`,
        type: "relay",
        relayEndpoint: "relay.example:443",
        daemonPublicKeyB64: "key",
        ...(password ? { password } : {}),
      },
    ],
    preferredConnectionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// A daemon that records what it was asked to merge and answers with a fixed replica.
function fakeDaemon(answer: ReplicaExchange, fail = false) {
  const calls: unknown[] = [];
  const client: ReplicaClient = {
    exchangeHostSync: async (input) => {
      calls.push(input);
      if (fail) {
        throw new Error("daemon down");
      }
      return answer;
    },
  };
  return { client, calls };
}

function record(id: string, data: Record<string, unknown>, deleted = false) {
  return { kind: "host" as const, id, version: 1, author: "srv_local", deleted, data };
}

function hostData(serverId: string) {
  const { serverId: _ignored, ...data } = profile(serverId);
  return data as Record<string, unknown>;
}

describe("hostRecordsToProfiles", () => {
  test("drops tombstones and records it cannot read", () => {
    const profiles = hostRecordsToProfiles([
      { kind: "host", id: "srv_dead", version: 2, author: "a", deleted: true },
      { kind: "rule", id: "rule_1", version: 1, author: "a", data: { label: "x" } },
      {
        kind: "host",
        id: "srv_ok",
        version: 1,
        author: "a",
        data: {
          label: "ok",
          connections: [
            {
              id: "relay:h",
              type: "relay",
              relayEndpoint: "relay.example:443",
              daemonPublicKeyB64: "key",
            },
          ],
        },
      },
    ]);
    expect(profiles.map((item) => item.serverId)).toEqual(["srv_ok"]);
  });
});

describe("replicaDiff", () => {
  test("strips passwords before anything is sent to the replica", () => {
    const changes = replicaDiff([profile("srv_a", "secret")], []);
    expect(JSON.stringify(changes)).not.toContain("secret");
    expect(changes[0]?.id).toBe("srv_a");
  });

  test("sends nothing when the replica already holds the same host", () => {
    const changes = replicaDiff([profile("srv_a")], [record("srv_a", hostData("srv_a"))]);
    expect(changes).toEqual([]);
  });

  // An edit that only lists the surviving hosts leaves every removed host in the replica, and the
  // next read brings it back. Removals have to travel as deletes.
  test("sends removed hosts as deletes", () => {
    const changes = replicaDiff([profile("srv_a")], [record("srv_gone", hostData("srv_gone"))]);
    expect(changes).toContainEqual({ kind: "host", id: "srv_gone", delete: true });
  });

  // A tombstone wins over a stale browser copy, or deleting a host would never stick.
  test("never re-sends a host the chain deleted", () => {
    const changes = replicaDiff([profile("srv_dead")], [record("srv_dead", {}, true)]);
    expect(changes).toEqual([]);
  });
});

describe("exchangeReplica", () => {
  // The replica returns records sorted by id. Adopting that order reshuffled the host list on every
  // connect, which moved whatever a list index pointed at.
  test("keeps the caller's host order and appends new hosts", async () => {
    const hostRecord = (id: string) => ({
      kind: "host" as const,
      id,
      version: 1,
      author: "srv",
      data: {
        label: id,
        connections: [
          {
            id: `relay:${id}`,
            type: "relay",
            relayEndpoint: "relay.example:443",
            daemonPublicKeyB64: "key",
          },
        ],
      },
    });
    const { client } = fakeDaemon({
      records: [hostRecord("srv_a"), hostRecord("srv_m"), hostRecord("srv_z")],
    });
    const result = await exchangeReplica(
      client,
      [profile("srv_z"), profile("srv_a")],
      [hostRecord("srv_a"), hostRecord("srv_z")],
    );
    expect(result?.profiles.map((entry) => entry.serverId)).toEqual(["srv_z", "srv_a", "srv_m"]);
  });

  // A daemon's replica is empty until something writes to it. Reading only, then adopting the
  // reply, deleted the browser's host list on the first connection to a fresh daemon.
  test("sends the browser's hosts, so an empty replica cannot wipe them", async () => {
    const { client, calls } = fakeDaemon({ records: [] });
    await exchangeReplica(client, [profile("srv_a"), profile("srv_b")], []);
    const [input] = calls as { changes?: { id: string }[] }[];
    expect(input?.changes?.map((change) => change.id).sort()).toEqual(["srv_a", "srv_b"]);
  });

  test("returns the replica's hosts and keeps the browser's passwords", async () => {
    const stored = profile("srv_b");
    const { client } = fakeDaemon({
      records: [
        {
          kind: "host",
          id: "srv_b",
          version: 1,
          author: "srv_local",
          data: {
            label: stored.label,
            connections: [
              {
                type: "relay",
                relayEndpoint: "relay.example:443",
                daemonPublicKeyB64: "key",
              },
            ],
          },
        },
      ],
    });

    const result = await exchangeReplica(client, [profile("srv_b", "kept")], []);

    expect(result?.profiles.map((item) => item.serverId)).toEqual(["srv_b"]);
    expect(result?.profiles[0]?.connections[0]).toMatchObject({ password: "kept" });
    // The raw records come back so the browser can carry them to the next daemon in the chain.
    expect(result?.records[0]?.id).toBe("srv_b");
  });

  test("returns null when the daemon does not support sync, leaving the caller its own copy", async () => {
    const { client } = fakeDaemon({}, true);
    expect(await exchangeReplica(client, [profile("srv_a")], [])).toBeNull();
  });

  // The browser is the chain's transport: records it holds from another daemon travel with the
  // next exchange, which is how a daemon learns about replicas it has never seen.
  test("carries records from other daemons into the exchange", async () => {
    const { client, calls } = fakeDaemon({ records: [] });
    await exchangeReplica(
      client,
      [profile("srv_a")],
      [record("srv_remote", hostData("srv_remote"))],
    );
    const [input] = calls as { records?: { id: string }[] }[];
    expect(input?.records?.map((item) => item.id)).toEqual(["srv_remote"]);
  });

  test("returns null and sends nothing the daemon rejects", async () => {
    const { client } = fakeDaemon({ error: "hostsync: document exceeds the size limit" });
    expect(await exchangeReplica(client, [profile("srv_a")], [])).toBeNull();
  });
});

describe("pushReplica", () => {
  test("reports failure instead of throwing when the daemon rejects the write", async () => {
    const { client } = fakeDaemon({ error: "hostsync: document exceeds the size limit" });
    expect(await pushReplica(client, [{ kind: "host", id: "srv_a", data: {} }])).toBe(false);
  });

  test("sends nothing when there is nothing to send", async () => {
    const { client, calls } = fakeDaemon({ records: [] });
    expect(await pushReplica(client, [])).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("rememberPasswords", () => {
  test("only restores a password for the same host and connection", () => {
    const [restored] = rememberPasswords(
      [profile("srv_a"), profile("srv_b")],
      [profile("srv_a", "only-a")],
    );
    expect(restored?.connections[0]).toMatchObject({ password: "only-a" });
  });

  // A host entered as `localhost` and reported by the daemon as `127.0.0.1` is the same endpoint.
  // Matching on the raw string dropped the password after the replica overwrote the browser copy.
  test("keeps the password when the endpoint spelling differs", () => {
    const typed = {
      ...profile("srv_a"),
      connections: [
        {
          id: "direct:localhost:8792",
          type: "directTcp",
          endpoint: "localhost:8792",
          password: "typed",
        },
      ],
    } as HostProfile;
    const reported = {
      ...profile("srv_a"),
      connections: [{ id: "direct:127.0.0.1:8792", type: "directTcp", endpoint: "127.0.0.1:8792" }],
    } as HostProfile;

    const [restored] = rememberPasswords([reported], [typed]);
    expect(restored?.connections[0]).toMatchObject({ password: "typed" });
  });
});
