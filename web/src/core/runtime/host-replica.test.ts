import { describe, expect, test } from "vitest";
import type { HostProfile } from "@/types/host-connection";
import {
  hostRecordsToProfiles,
  loadSharedReplica,
  profilesToChanges,
  rememberPasswords,
  saveSharedReplica,
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

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value);
    },
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

describe("profilesToChanges", () => {
  test("strips passwords before anything is sent to the replica", () => {
    const changes = profilesToChanges([profile("srv_a", "secret")]);
    expect(JSON.stringify(changes)).not.toContain("secret");
    expect(changes[0]?.id).toBe("srv_a");
  });
});

describe("loadSharedReplica", () => {
  test("imports the browser's old list once, keyed by serverId", async () => {
    const storage = memoryStorage();
    const { client, calls } = fakeDaemon({ records: [] });

    await loadSharedReplica(client, [profile("srv_a", "secret")], storage);

    const first = calls[0] as { changes: { id: string }[] };
    expect(first.changes.map((change) => change.id)).toEqual(["srv_a"]);
    expect(JSON.stringify(first)).not.toContain("secret");

    calls.length = 0;
    await loadSharedReplica(client, [profile("srv_a", "secret")], storage);
    expect((calls[0] as { changes: unknown[] }).changes).toEqual([]);
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

    const result = await loadSharedReplica(
      client,
      [profile("srv_b", "kept")],
      memoryStorage({ "@byspace:daemon-registry-imported": "1" }),
    );

    expect(result?.map((item) => item.serverId)).toEqual(["srv_b"]);
    expect(result?.[0]?.connections[0]).toMatchObject({ password: "kept" });
  });

  test("returns null when the daemon does not support sync, leaving the caller its own copy", async () => {
    const { client } = fakeDaemon({}, true);
    const result = await loadSharedReplica(client, [profile("srv_a")], memoryStorage());
    expect(result).toBeNull();
  });

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

describe("saveSharedReplica", () => {
  test("reports failure instead of throwing when the daemon rejects the write", async () => {
    const { client } = fakeDaemon({ error: "hostsync: document exceeds the size limit" });
    expect(await saveSharedReplica(client, [profile("srv_a")])).toBe(false);
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
});
