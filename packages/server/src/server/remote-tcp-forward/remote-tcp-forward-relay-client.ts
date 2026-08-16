import { randomUUID } from "node:crypto";
import type { ConnectionOfferV2 } from "@bytetrue/byspace-protocol/connection-offer";
import {
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@bytetrue/byspace-protocol/daemon-endpoints";
import { createEncryptedTransport } from "@bytetrue/byspace-client/internal/daemon-client-relay-e2ee-transport";
import { createWebSocketTransportFactory } from "@bytetrue/byspace-client/internal/daemon-client-websocket-transport";
import type {
  DaemonTransport,
  WebSocketLike,
} from "@bytetrue/byspace-client/internal/daemon-client-transport-types";
import { REMOTE_TCP_FORWARD_CONNECTION_PREFIX } from "@bytetrue/byspace-protocol/remote-tcp-forward";
import WebSocketClient from "ws";
import type { RemoteTcpForwardChannel } from "./remote-tcp-forward-bridge.js";

const RELAY_CONNECT_TIMEOUT_MS = 15_000;

export async function connectRemoteTcpForwardRelay(
  target: ConnectionOfferV2,
): Promise<RemoteTcpForwardChannel> {
  const useTls = target.relay.useTls ?? shouldUseTlsForDefaultHostedRelay(target.relay.endpoint);
  const url = buildRelayWebSocketUrl({
    endpoint: target.relay.endpoint,
    useTls,
    serverId: target.serverId,
    role: "client",
    version: 2,
    connectionId: `${REMOTE_TCP_FORWARD_CONNECTION_PREFIX}${randomUUID()}`,
  });
  const baseFactory = createWebSocketTransportFactory((socketUrl, options) => {
    const protocols = options?.protocols;
    return new WebSocketClient(
      socketUrl,
      protocols && protocols.length > 0 ? protocols : undefined,
    ) as unknown as WebSocketLike;
  });
  const base = baseFactory({ url });
  const encrypted = createEncryptedTransport(base, target.daemonPublicKeyB64, {
    warn: () => undefined,
  });
  await waitForOpen(encrypted, RELAY_CONNECT_TIMEOUT_MS);
  return adaptTransport(encrypted);
}

function waitForOpen(transport: DaemonTransport, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribeOpen: () => void = () => undefined;
    let unsubscribeClose: () => void = () => undefined;
    let unsubscribeError: () => void = () => undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribeOpen();
      unsubscribeClose();
      unsubscribeError();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => {
        transport.close(4002, "Relay connection timed out");
        reject(new Error("Remote daemon Relay connection timed out"));
      });
    }, timeoutMs);
    (timeout as unknown as { unref?: () => void }).unref?.();
    unsubscribeOpen = transport.onOpen(() => finish(resolve));
    unsubscribeClose = transport.onClose(() =>
      finish(() => reject(new Error("Remote daemon Relay connection closed before E2EE opened"))),
    );
    unsubscribeError = transport.onError((error) =>
      finish(() =>
        reject(error instanceof Error ? error : new Error("Remote daemon Relay connection failed")),
      ),
    );
  });
}

function adaptTransport(transport: DaemonTransport): RemoteTcpForwardChannel {
  return {
    send: (data) => transport.send(data),
    close: (code, reason) => transport.close(code, reason),
    on: (event, listener) => {
      switch (event) {
        case "message":
          transport.onMessage((data) => listener(data));
          return;
        case "close":
          transport.onClose((data) => listener(data));
          return;
        case "error":
          transport.onError((data) => listener(data));
      }
    },
  };
}
