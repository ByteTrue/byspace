import type { HostSyncRecord } from "@bytetrue/protocol/messages";
import { normalizeEndpoint } from "@bytetrue/protocol/daemon-endpoints";
import {
  normalizeStoredHostProfile,
  withoutSecrets,
  type HostProfile,
} from "@/types/host-connection";

// The browser copy of the host list, kept so a frontend remembers passwords and still has the list
// when every daemon is stopped. The replicas on the daemons are what the chain shares.

export interface ReplicaExchange {
  records?: HostSyncRecord[];
  error?: string;
}

// ReplicaChange is one edit an exchange carries: an upsert has data, a removal has delete.
export interface ReplicaChange {
  kind: "host";
  id: string;
  delete?: boolean;
  data?: Record<string, unknown>;
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

// rememberPasswords copies passwords from the browser copy onto the replica's profiles.
//
// The replica never carries passwords, but the browser copy does. Without this, adopting the
// replica would forget every password the moment a daemon answered.
function connectionKey(serverId: string, connection: HostProfile["connections"][number]): string {
  if (connection.type === "relay") {
    return `${serverId}/relay/${normalizeEndpoint(connection.relayEndpoint)}`;
  }
  if (connection.type === "directTcp") {
    // Normalize the endpoint, or a host entered as `localhost` will not match the same host the
    // daemon reports as `127.0.0.1` and the remembered password is dropped.
    return `${serverId}/direct/${normalizeEndpoint(connection.endpoint)}`;
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

// replicaDiff is the edit list a save has to carry: hosts that changed since the replica was read,
// plus replica hosts this browser no longer has.
//
// A tombstone always wins: a host the chain deleted is never re-sent as an edit, even when this
// browser still has it cached. That is what stops a deleted host from resurrecting.
export function replicaDiff(
  profiles: readonly HostProfile[],
  records: readonly HostSyncRecord[],
): ReplicaChange[] {
  const known = new Map(
    records.filter((record) => record.kind === "host").map((record) => [record.id, record]),
  );
  const changes: ReplicaChange[] = [];
  const live = new Set<string>();
  for (const profile of profiles) {
    live.add(profile.serverId);
    const record = known.get(profile.serverId);
    if (record?.deleted) {
      continue;
    }
    const { serverId, ...data } = withoutSecrets(profile);
    if (record && JSON.stringify(record.data) === JSON.stringify(data)) {
      continue;
    }
    changes.push({ kind: "host", id: serverId, data });
  }
  for (const [id, record] of known) {
    if (!record.deleted && !live.has(id)) {
      changes.push({ kind: "host", id, delete: true });
    }
  }
  return changes;
}

// missingHostChanges lists hosts the replica has never seen. This is the only push that runs on
// connect: a host the user added while no daemon was reachable, and the browser's pre-sync list on
// first run. Pushing everything on connect would restamp records the chain already had newer.
export function missingHostChanges(
  profiles: readonly HostProfile[],
  records: readonly HostSyncRecord[],
): ReplicaChange[] {
  const known = new Set(
    records.filter((record) => record.kind === "host").map((result) => result.id),
  );
  return profiles
    .filter((profile) => !known.has(profile.serverId))
    .map((profile) => {
      const { serverId, ...data } = withoutSecrets(profile);
      return { kind: "host" as const, id: serverId, data };
    });
}

export interface ReplicaSnapshot {
  profiles: HostProfile[];
  records: HostSyncRecord[];
}

// pullReplica merges the records this browser carried into one daemon's replica and returns the
// result. Null means that daemon does not support sync or refused, so the caller keeps its copy.
//
// carried are the records this browser holds from other daemons. Handing them over is what makes
// the chain converge: the browser is the only participant that reaches every daemon, so a daemon
// the user reached only from their phone learns the rest of the chain when the phone carries the
// list back.
export async function pullReplica(
  client: ReplicaClient,
  profiles: readonly HostProfile[],
  carried: readonly HostSyncRecord[],
): Promise<ReplicaSnapshot | null> {
  let result: ReplicaExchange;
  try {
    result = await client.exchangeHostSync(carried.length > 0 ? { records: [...carried] } : {});
  } catch {
    return null;
  }
  if (result.error) {
    return null;
  }
  const merged = result.records ?? [];
  return {
    profiles: rememberPasswords(hostRecordsToProfiles(merged), profiles),
    records: merged,
  };
}

// pushReplica sends one edit list and reports whether the daemon took it.
export async function pushReplica(
  client: ReplicaClient,
  changes: readonly ReplicaChange[],
): Promise<boolean> {
  if (changes.length === 0) {
    return true;
  }
  try {
    const result = await client.exchangeHostSync({ changes: [...changes] });
    return !result.error;
  } catch {
    return false;
  }
}
