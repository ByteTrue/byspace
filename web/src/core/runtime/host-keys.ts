import type { HostProfile } from "@/types/host-connection";

// The public keys this browser has accepted, keyed by serverId. Like SSH known_hosts: a host whose
// key changes is not connected until the user says the change is expected.
const STORAGE_KEY = "@byspace:host-keys";

export interface KeyStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// memoryKeyStore keeps accepted keys in memory. The runtime uses it when no browser store is
// available, which is also what tests run with.
export function memoryKeyStore(): KeyStore {
  const items = new Map<string, string>();
  return {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
  };
}

export function hostPublicKey(host: HostProfile): string | null {
  const relay = host.connections.find((connection) => connection.type === "relay");
  return relay && relay.type === "relay" ? relay.daemonPublicKeyB64 : null;
}

async function readKeys(store: KeyStore): Promise<Record<string, string>> {
  const raw = await store.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export type KeyDecision = "trusted" | "first-seen" | "changed";

// judgeHostKey compares a host's current key with the one this browser accepted before.
export async function judgeHostKey(store: KeyStore, host: HostProfile): Promise<KeyDecision> {
  const key = hostPublicKey(host);
  if (!key) {
    return "trusted";
  }
  const known = (await readKeys(store))[host.serverId];
  if (!known) {
    return "first-seen";
  }
  return known === key ? "trusted" : "changed";
}

// acceptHostKey records the key the user has now seen, whether for the first time or after a change.
export async function acceptHostKey(store: KeyStore, host: HostProfile): Promise<void> {
  const key = hostPublicKey(host);
  if (!key) {
    return;
  }
  const keys = await readKeys(store);
  keys[host.serverId] = key;
  await store.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export interface KeyChangePrompt {
  (host: HostProfile): Promise<boolean>;
}

// guardHostKey blocks a connection whose key changed until the user confirms, and remembers a key
// the first time it is seen. A host with no relay key has nothing to pin.
export async function guardHostKey(
  store: KeyStore,
  host: HostProfile,
  confirmChange: KeyChangePrompt,
): Promise<boolean> {
  const decision = await judgeHostKey(store, host);
  if (decision === "trusted") {
    return true;
  }
  if (decision === "changed" && !(await confirmChange(host))) {
    return false;
  }
  await acceptHostKey(store, host);
  return true;
}
