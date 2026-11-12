import { describe, expect, test } from "vitest";
import type { HostProfile } from "@/types/host-connection";
import { acceptHostKey, guardHostKey, judgeHostKey } from "./host-keys";

function host(serverId: string, key: string | null): HostProfile {
  return {
    serverId,
    label: serverId,
    appearance: { color: "none", badgeDisplay: "auto" },
    lifecycle: {},
    connections: key
      ? [
          {
            id: "relay:h",
            type: "relay",
            relayEndpoint: "relay.example:443",
            daemonPublicKeyB64: key,
          },
        ]
      : [{ id: "direct:localhost:6777", type: "directTcp", endpoint: "localhost:6777" }],
    preferredConnectionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function memory() {
  const items = new Map<string, string>();
  return {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("judgeHostKey", () => {
  test("a host seen for the first time is not yet trusted", async () => {
    expect(await judgeHostKey(memory(), host("srv_a", "key-a"))).toBe("first-seen");
  });

  test("the same key again is trusted", async () => {
    const store = memory();
    await acceptHostKey(store, host("srv_a", "key-a"));
    expect(await judgeHostKey(store, host("srv_a", "key-a"))).toBe("trusted");
  });

  test("a different key is reported as changed", async () => {
    const store = memory();
    await acceptHostKey(store, host("srv_a", "key-a"));
    expect(await judgeHostKey(store, host("srv_a", "key-b"))).toBe("changed");
  });

  test("a host with no relay key has nothing to pin", async () => {
    expect(await judgeHostKey(memory(), host("srv_a", null))).toBe("trusted");
  });
});

describe("guardHostKey", () => {
  test("remembers a key the first time without asking", async () => {
    const store = memory();
    let asked = false;
    const allowed = await guardHostKey(store, host("srv_a", "key-a"), async () => {
      asked = true;
      return false;
    });
    expect(allowed).toBe(true);
    expect(asked).toBe(false);
    expect(await judgeHostKey(store, host("srv_a", "key-a"))).toBe("trusted");
  });

  test("blocks a changed key until the user confirms", async () => {
    const store = memory();
    await acceptHostKey(store, host("srv_a", "key-a"));

    const blocked = await guardHostKey(store, host("srv_a", "key-b"), async () => false);
    expect(blocked).toBe(false);
    expect(await judgeHostKey(store, host("srv_a", "key-a"))).toBe("trusted");

    const allowed = await guardHostKey(store, host("srv_a", "key-b"), async () => true);
    expect(allowed).toBe(true);
    expect(await judgeHostKey(store, host("srv_a", "key-b"))).toBe("trusted");
  });
});
