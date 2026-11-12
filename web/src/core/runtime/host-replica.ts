import type { HostSyncRecord } from "@bytetrue/protocol/messages";
import {
  normalizeStoredHostProfile,
  withoutSecrets,
  type HostProfile,
} from "@/types/host-connection";

// The browser copy of the host list, kept so a frontend remembers passwords and still has the list
// when the local daemon is stopped. The replica on the daemon is what frontends on this machine share.
const IMPORTED_FLAG = "@byspace:daemon-registry-imported";

export interface ReplicaExchange {
  records?: HostSyncRecord[];
  error?: string;
}

export interface ReplicaClient {
  exchangeHostSync(input: {
    records?: HostSyncRecord[];
    changes?: { kind: "host"; id: string; delete?: boolean; data?: Record<string, unknown> }[];
  }): Promise<ReplicaExchange>;
}

// hostRecordsToProfiles reads the host entries out of a replica. Tombstones and records this app
// does not understand are dropped rather than shown.
export function hostRecordsToProfiles(records: readonly HostSyncRecord[]): HostProfile[] {
  const profiles: HostProfile[] = [];
  for (const record of records) {
    if (record.kind !== "host" || record.deleted || !record.data) {
      continue;
    }
    const profile = normalizeStoredHostProfile({ ...record.data, serverId: record.id });
    if (profile) {
      profiles.push(profile);
    }
  }
  return profiles;
}

// profilesToChanges turns host profiles into replica edits, with passwords removed.
export function profilesToChanges(
  profiles: readonly HostProfile[],
): { kind: "host"; id: string; data: Record<string, unknown> }[] {
  return profiles.map((profile) => {
    const { serverId, ...data } = withoutSecrets(profile);
    return { kind: "host", id: serverId, data };
  });
}

// rememberPasswords copies passwords from the browser copy onto the replica's profiles.
//
// The replica never carries passwords, but the browser copy does. Without this, adopting the
// replica would forget every password the moment the local daemon answered.
function connectionKey(serverId: string, connection: HostProfile["connections"][number]): string {
  if (connection.type === "relay") {
    return `${serverId}/relay/${connection.relayEndpoint}`;
  }
  if (connection.type === "directTcp") {
    return `${serverId}/direct/${connection.endpoint}`;
  }
  if (connection.type === "remoteSsh") {
    return `${serverId}/ssh/${connection.host}`;
  }
  return `${serverId}/${connection.type}/${connection.path}`;
}

export function rememberPasswords(
  replica: readonly HostProfile[],
  cached: readonly HostProfile[],
): HostProfile[] {
  const passwords = new Map<string, string>();
  for (const profile of cached) {
    for (const connection of profile.connections) {
      if ("password" in connection && connection.password) {
        passwords.set(connectionKey(profile.serverId, connection), connection.password);
      }
    }
  }
  return replica.map((profile) => ({
    ...profile,
    connections: profile.connections.map((connection) => {
      const password = passwords.get(connectionKey(profile.serverId, connection));
      return password ? { ...connection, password } : connection;
    }),
  }));
}

export interface SharedReplicaStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// loadSharedReplica returns the host list the local daemon holds, importing the browser's old list
// the first time. Null means the daemon does not support sync, so the caller keeps its own copy.
export async function loadSharedReplica(
  client: ReplicaClient,
  cached: readonly HostProfile[],
  storage: SharedReplicaStorage,
): Promise<HostProfile[] | null> {
  const alreadyImported = (await storage.getItem(IMPORTED_FLAG)) === "1";
  const changes = alreadyImported ? [] : profilesToChanges(cached);
  let result: ReplicaExchange;
  try {
    result = await client.exchangeHostSync({ changes });
  } catch {
    return null;
  }
  if (result.error) {
    return null;
  }
  if (!alreadyImported) {
    await storage.setItem(IMPORTED_FLAG, "1");
  }
  return rememberPasswords(hostRecordsToProfiles(result.records ?? []), cached);
}

// saveSharedReplica writes the host list to the local daemon. Passwords are stripped first.
export async function saveSharedReplica(
  client: ReplicaClient,
  profiles: readonly HostProfile[],
): Promise<boolean> {
  try {
    const result = await client.exchangeHostSync({ changes: profilesToChanges(profiles) });
    return !result.error;
  } catch {
    return false;
  }
}
