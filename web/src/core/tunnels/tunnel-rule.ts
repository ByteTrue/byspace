// A tunnel rule names two daemons: the one whose port is exposed, and the one that listens for it.
//
// Creating a rule writes both halves while the client holds a connection to each. The target records
// a grant for the source's key; the source records the forward. Neither half carries the other's
// password, and the grant never enters the synced replica.

export interface TunnelEndpointClient {
  grantTunnel(grant: { publicKey: string; port: number }): Promise<{ ok: boolean; error?: string }>;
  createTunnel(config: {
    peerId: string;
    url?: string;
    daemonPublicKeyB64?: string;
    forwards: { remotePort: number; localPort?: number; label?: string }[];
  }): Promise<{ ok: boolean; error?: string }>;
  exchangeHostSync(input: {
    changes?: { kind: "rule"; id: string; data?: Record<string, unknown> }[];
  }): Promise<{ error?: string }>;
}

export interface TunnelRuleInput {
  // The daemon whose port is reached through the tunnel.
  target: { serverId: string; publicKey: string; client: TunnelEndpointClient };
  // The daemon that opens the local port.
  source: { serverId: string; publicKey: string; client: TunnelEndpointClient };
  targetPort: number;
  listenHost: string;
  listenPort: number;
  label?: string;
}

export interface TunnelRuleResult {
  ok: boolean;
  error?: string;
}

// establishTunnelRule writes the grant on the target and the forward on the source, then records the
// rule in the replica so other devices can see it. The grant is what permits the forward; the
// replica entry is display only.
export async function establishTunnelRule(input: TunnelRuleInput): Promise<TunnelRuleResult> {
  const grant = await input.target.client.grantTunnel({
    publicKey: input.source.publicKey,
    port: input.targetPort,
  });
  if (!grant.ok) {
    return { ok: false, error: grant.error ?? "The target refused the grant." };
  }

  const forward = await input.source.client.createTunnel({
    peerId: input.target.serverId,
    daemonPublicKeyB64: input.target.publicKey,
    forwards: [
      {
        remotePort: input.targetPort,
        localPort: input.listenPort,
        ...(input.label ? { label: input.label } : {}),
      },
    ],
  });
  if (!forward.ok) {
    return { ok: false, error: forward.error ?? "The source refused the forward." };
  }

  const rule = await input.source.client.exchangeHostSync({
    changes: [
      {
        kind: "rule",
        id: `${input.source.serverId}->${input.target.serverId}:${input.targetPort}`,
        data: {
          sourceServerId: input.source.serverId,
          targetServerId: input.target.serverId,
          targetPort: input.targetPort,
          listenHost: input.listenHost,
          listenPort: input.listenPort,
          ...(input.label ? { label: input.label } : {}),
        },
      },
    ],
  });
  if (rule.error) {
    return { ok: false, error: rule.error };
  }
  return { ok: true };
}

// createTunnelFromSelection writes a rule when both ends are known hosts, and falls back to a
// one-sided forward when the target is not a daemon this device can write a grant to.
export async function createTunnelFromSelection(input: {
  selection:
    | { kind: "host"; target: { serverId: string; daemonPublicKeyB64?: string } }
    | { kind: "offer" };
  sourceServerId: string;
  hosts: readonly {
    serverId: string;
    connections: readonly { type: string; daemonPublicKeyB64?: string }[];
  }[];
  sourceClient: TunnelEndpointClient;
  targetClient: TunnelEndpointClient | null;
  forwards: { remotePort: number; localPort?: number }[];
  password: string;
  offerUrl?: string;
  createOneSided: () => Promise<TunnelRuleResult>;
}): Promise<TunnelRuleResult> {
  if (input.selection.kind === "offer") {
    return input.createOneSided();
  }
  const ends = ruleEndpoints({
    sourceServerId: input.sourceServerId,
    targetServerId: input.selection.target.serverId,
    targetPublicKey: input.selection.target.daemonPublicKeyB64 ?? null,
    hosts: input.hosts,
    targetConnected: input.targetClient !== null,
  });
  if (!ends || !input.targetClient) {
    return input.createOneSided();
  }
  const first = input.forwards[0];
  return establishTunnelRule({
    target: {
      serverId: input.selection.target.serverId,
      publicKey: ends.targetPublicKey,
      client: input.targetClient,
    },
    source: {
      serverId: input.sourceServerId,
      publicKey: ends.sourcePublicKey,
      client: input.sourceClient,
    },
    targetPort: first?.remotePort ?? 0,
    listenHost: DEFAULT_LISTEN_HOST,
    listenPort: first?.localPort ?? first?.remotePort ?? 0,
  });
}

// ruleEndpoints resolves the two ends of a rule from the hosts this device knows.
//
// Both ends must be hosts with a relay key, and the target must be a daemon this device is connected
// to, because the grant is written there. Anything else returns null and the caller uses the
// single-ended path.
export function ruleEndpoints(input: {
  sourceServerId: string;
  targetServerId: string;
  targetPublicKey: string | null;
  hosts: readonly {
    serverId: string;
    connections: readonly { type: string; daemonPublicKeyB64?: string }[];
  }[];
  targetConnected: boolean;
}): { sourcePublicKey: string; targetPublicKey: string } | null {
  if (!input.targetConnected || !input.targetPublicKey) {
    return null;
  }
  const source = input.hosts.find((host) => host.serverId === input.sourceServerId);
  const relay = source?.connections.find((connection) => connection.type === "relay");
  const sourcePublicKey = relay?.daemonPublicKeyB64;
  if (!sourcePublicKey) {
    return null;
  }
  return { sourcePublicKey, targetPublicKey: input.targetPublicKey };
}

// DEFAULT_LISTEN_HOST is where a tunnel listens unless the user picks another address. Loopback
// keeps the forwarded port off the network; anything else is a choice the UI should flag.
export const DEFAULT_LISTEN_HOST = "127.0.0.1";

// listenHostIsOpen reports whether a listen address accepts connections from the network, which is
// the case the UI warns about.
export function listenHostIsOpen(host: string): boolean {
  return host.trim() === "0.0.0.0" || host.trim() === "::";
}
