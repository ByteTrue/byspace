import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import { parseConnectionOfferFromUrl } from "@bytetrue/byspace-protocol/connection-offer";
import type { PreparedPortForward } from "./port-forward-form";

export type PortForwardClient = Pick<
  DaemonClient,
  | "getDaemonPairingOffer"
  | "getLastServerInfoMessage"
  | "openRemoteTcpForward"
  | "closeRemoteTcpForward"
  | "subscribeConnectionStatus"
>;

export type PortForwardServiceErrorCode =
  | "source-unavailable"
  | "target-unavailable"
  | "source-update-required"
  | "target-update-required"
  | "target-relay-disabled"
  | "invalid-target-offer";

export class PortForwardServiceError extends Error {
  constructor(public readonly code: PortForwardServiceErrorCode) {
    super(code);
    this.name = "PortForwardServiceError";
  }
}

export interface OpenedPortForward {
  forwardId: string;
  sourceServerId: string;
  targetServerId: string;
  localHost: string;
  localPort: number;
  targetPort: number;
  createdAt: number;
}

export async function openPortForward(
  input: PreparedPortForward,
  resolveClient: (serverId: string) => PortForwardClient | null,
  now: () => number = Date.now,
): Promise<{ forward: OpenedPortForward; sourceClient: PortForwardClient }> {
  const sourceClient = resolveClient(input.sourceServerId);
  if (!sourceClient) throw new PortForwardServiceError("source-unavailable");
  if (sourceClient.getLastServerInfoMessage()?.features?.remoteTcpForward !== true) {
    throw new PortForwardServiceError("source-update-required");
  }

  const targetClient = resolveClient(input.targetServerId);
  if (!targetClient) throw new PortForwardServiceError("target-unavailable");
  if (targetClient.getLastServerInfoMessage()?.features?.remoteTcpForward !== true) {
    throw new PortForwardServiceError("target-update-required");
  }

  const pairing = await targetClient.getDaemonPairingOffer();
  if (!pairing.relayEnabled) throw new PortForwardServiceError("target-relay-disabled");

  let target: ReturnType<typeof parseConnectionOfferFromUrl>;
  try {
    target = parseConnectionOfferFromUrl(pairing.url);
  } catch {
    throw new PortForwardServiceError("invalid-target-offer");
  }
  if (!target || target.serverId !== input.targetServerId) {
    throw new PortForwardServiceError("invalid-target-offer");
  }

  const result = await sourceClient.openRemoteTcpForward({
    target,
    targetPort: input.targetPort,
    ...(input.localPort === undefined ? {} : { localPort: input.localPort }),
  });

  return {
    forward: {
      forwardId: result.forwardId,
      sourceServerId: input.sourceServerId,
      targetServerId: input.targetServerId,
      localHost: result.localHost,
      localPort: result.localPort,
      targetPort: result.targetPort,
      createdAt: now(),
    },
    sourceClient,
  };
}
