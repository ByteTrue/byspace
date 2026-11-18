// A tunnel rule names two daemons: the one whose port is exposed, and the one that listens for it.
//
// Creating a rule writes both halves while the client holds a connection to each. The target records
// a grant for the source's key; the source records the forward. Neither half carries the other's
// password, and the grant never enters the synced replica.

export interface TunnelEndpointClient {
  grantTunnel(grant: { publicKey: string; host?: string; port: number }): Promise<{
    ok: boolean;
    error?: string;
  }>;
  createTunnel(config: {
    peerId: string;
    url?: string;
    daemonPublicKeyB64?: string;
    forwards: {
      remotePort: number;
      remoteHost?: string;
      localPort?: number;
      listenHost?: string;
      label?: string;
    }[];
  }): Promise<{ ok: boolean; error?: string }>;
  exchangeHostSync(input: {
    changes?: { kind: "rule"; id: string; data?: Record<string, unknown> }[];
  }): Promise<{ error?: string }>;
}

export interface TunnelRuleInput {
  // The daemon whose destination is reached through the tunnel.
  target: {
    serverId: string;
    publicKey: string;
    url?: string;
    label?: string;
    client: TunnelEndpointClient;
  };
  // The daemon that opens the local port.
  source: { serverId: string; publicKey: string; client: TunnelEndpointClient };
  targetPort: number;
  // The destination on the target's network. Empty means the target's own machine.
  targetHost?: string;
  listenHost: string;
  listenPort: number;
  label?: string;
}

export interface TunnelRuleResult {
  ok: boolean;
  error?: string;
}

// grantTunnelDestination records on the target that the source daemon may open one destination.
//
// The grant is per destination, so an edit that moves a rule to another host:port has to write a new
// one: the edit sheet updates the forward in place and never runs the add flow. Loopback is omitted
// from the grant, which is what every grant written before hosts means.
export async function grantTunnelDestination(input: {
  targetClient: TunnelEndpointClient | null;
  sourceServerId: string;
  targetServerId: string;
  targetPublicKey: string | null;
  hosts: readonly {
    serverId: string;
    connections: readonly { type: string; daemonPublicKeyB64?: string }[];
  }[];
  host: string;
  port: number;
}): Promise<TunnelRuleResult> {
  if (!input.targetClient) {
    return { ok: false, error: "The paired host is not connected." };
  }
  const ends = ruleEndpoints({
    sourceServerId: input.sourceServerId,
    targetServerId: input.targetServerId,
    targetPublicKey: input.targetPublicKey,
    hosts: input.hosts,
    targetConnected: true,
  });
  if (!ends) {
    return {
      ok: false,
      error:
        "Cannot resolve the relay keys for this edit; the source or the target is missing one.",
    };
  }
  const trimmed = input.host.trim();
  const targetHost = isLoopbackTargetHost(trimmed) ? "" : trimmed;
  const grant = await input.targetClient.grantTunnel({
    publicKey: ends.sourcePublicKey,
    ...(targetHost ? { host: targetHost } : {}),
    port: input.port,
  });
  if (!grant.ok) {
    return { ok: false, error: grant.error ?? "The target refused the grant." };
  }
  return { ok: true };
}

// establishTunnelRule writes the grant on the target, the forward on the source, and a display copy
// of the rule into the replica. The grant is what permits the forward; the replica entry is there
// so the chain keeps the rule's shape. The tunnel list itself is assembled live from every host
// (fetchAggregatedTunnels), so nothing reads the replica entry yet.
export async function establishTunnelRule(input: TunnelRuleInput): Promise<TunnelRuleResult> {
  // Loopback is the daemon default. The grant omits it, which is what grants written before hosts
  // mean; the forward below states it explicitly, because an absent host is the ambiguous form.
  const trimmedTargetHost = (input.targetHost ?? "").trim();
  const targetHost = isLoopbackTargetHost(trimmedTargetHost) ? "" : trimmedTargetHost;
  const grant = await input.target.client.grantTunnel({
    publicKey: input.source.publicKey,
    ...(targetHost ? { host: targetHost } : {}),
    port: input.targetPort,
  });
  if (!grant.ok) {
    return { ok: false, error: grant.error ?? "The target refused the grant." };
  }

  const forward = await input.source.client.createTunnel({
    peerId: input.target.serverId,
    // The source daemon dials the peer itself, so the relay URL has to be in the forward. Without it
    // the daemon refuses to configure a peer it has never seen ("url is required").
    ...(input.target.url ? { url: input.target.url } : {}),
    ...(input.target.label ? { peerHostname: input.target.label } : {}),
    daemonPublicKeyB64: input.target.publicKey,
    forwards: [
      {
        remotePort: input.targetPort,
        // Stated even for loopback: the daemon reads an absent host as "this machine" only, and refuses
        // it when the port already has a rule for another host.
        remoteHost: targetHost || DEFAULT_LISTEN_HOST,
        localPort: input.listenPort,
        // The daemon binds this interface. Loopback is the default and is not sent; anything else
        // (a Docker bridge, 0.0.0.0) is a deliberate choice the UI warned about first.
        ...(input.listenHost && !isLoopbackListenHost(input.listenHost)
          ? { listenHost: input.listenHost }
          : {}),
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
          ...(targetHost ? { targetHost } : {}),
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
    | {
        kind: "host";
        target: { serverId: string; url: string; label: string; daemonPublicKeyB64?: string };
      }
    | { kind: "offer" };
  sourceServerId: string;
  hosts: readonly {
    serverId: string;
    connections: readonly { type: string; daemonPublicKeyB64?: string }[];
  }[];
  sourceClient: TunnelEndpointClient;
  targetClient: TunnelEndpointClient | null;
  forwards: { remotePort: number; remoteHost?: string; localPort?: number }[];
  listenHost?: string;
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
      url: input.selection.target.url,
      label: input.selection.target.label,
      client: input.targetClient,
    },
    source: {
      serverId: input.sourceServerId,
      publicKey: ends.sourcePublicKey,
      client: input.sourceClient,
    },
    targetPort: first?.remotePort ?? 0,
    targetHost: first?.remoteHost,
    listenHost:
      input.listenHost && input.listenHost.trim() !== ""
        ? input.listenHost.trim()
        : DEFAULT_LISTEN_HOST,
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

// tunnelEndStates describes the two ends of a tunnel for the rule list.
//
// The source end is the daemon that listens locally: its state is the forward's own state. The
// target end is the daemon whose port is exposed: this device only knows whether that daemon is
// connected, so "offline" is the strongest statement it can make without asking it.
export function tunnelEndStates(input: {
  forwardState: "connecting" | "connected" | "disconnected" | "error";
  sourceOnline: boolean;
  targetOnline: boolean;
}): { source: string; target: string } {
  const source = input.sourceOnline ? input.forwardState : "offline";
  const target = input.targetOnline ? "reachable" : "offline";
  return { source, target };
}

// DEFAULT_LISTEN_HOST is where a tunnel listens unless the user picks another address. Loopback
// keeps the forwarded port off the network; anything else is a choice the UI should flag.
export const DEFAULT_LISTEN_HOST = "127.0.0.1";

// isLoopbackTargetHost reports whether a destination is the peer's own machine. Loopback is the
// daemon default and is not sent, so an older daemon on either side keeps its meaning.
export function isLoopbackTargetHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  return trimmed === "" || trimmed === "127.0.0.1" || trimmed === "localhost" || trimmed === "::1";
}

// isLoopbackListenHost reports whether an address is the daemon's default, which is not sent as a
// listenHost so an older daemon and the stored config both keep the loopback meaning.
export function isLoopbackListenHost(host: string): boolean {
  const trimmed = host.trim();
  return trimmed === "127.0.0.1" || trimmed.toLowerCase() === "localhost";
}

// listenHostIsOpen reports whether a listen address accepts connections from the network, which is
// the case the UI warns about.
export function listenHostIsOpen(host: string): boolean {
  return host.trim() === "0.0.0.0" || host.trim() === "::";
}
