import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  DaemonTransport,
  DaemonTransportFactory,
} from "@getpaseo/client/internal/daemon-client-transport-types";
import type { RemoteSshHostConnection } from "@/types/host-connection";

/**
 * Transport factory for Remote SSH hosts on web/PWA: the daemon the client is
 * already connected to (the carrier) owns the SSH tunnel and relays the
 * remote daemon's WebSocket frames over the existing session.
 *
 * Mirrors the Electron desktop transport's semantics: frames are exchanged as
 * text or base64 binary, and the tunnel lifecycle follows the client's own
 * connect/close cycle.
 */

interface TunnelTransportOptions {
  url: string;
}

interface PendingFrame {
  data: string | Uint8Array | ArrayBuffer;
}

function toBase64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function createSshTunnelTransportFactory(
  carrier: DaemonClient,
  connection: RemoteSshHostConnection,
): DaemonTransportFactory {
  // One tunnel per transport factory; the tunnel id is stable per host
  // connection so reconnects reuse the daemon-side tunnel identity.
  const tunnelId = `tunnel_${connection.id.replace(/[^A-Za-z0-9_-]/gu, "_")}`.slice(0, 128);

  return (_options: TunnelTransportOptions): DaemonTransport => {
    let tunnelOpen = false;
    let closed = false;
    const messageHandlers = new Set<(data: unknown, isBinary: boolean) => void>();
    const openHandlers = new Set<() => void>();
    const closeHandlers = new Set<(event?: unknown) => void>();
    const errorHandlers = new Set<(event?: unknown) => void>();
    let unsubscribeEvents: (() => void) | null = null;
    const outgoingQueue: PendingFrame[] = [];
    let drainTimer: ReturnType<typeof setTimeout> | null = null;

    const notifyError = (message: string): void => {
      for (const handler of errorHandlers) handler(new Error(message));
    };

    const notifyClose = (): void => {
      if (closed) return;
      closed = true;
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      if (drainTimer !== null) clearTimeout(drainTimer);
      for (const handler of closeHandlers) handler();
    };

    const flushOutgoing = (): void => {
      drainTimer = null;
      if (outgoingQueue.length === 0) return;
      const batch = outgoingQueue.splice(0, outgoingQueue.length);
      void (async () => {
        for (const frame of batch) {
          try {
            const response = await carrier.sendSshTunnelFrame(
              typeof frame.data === "string"
                ? { tunnelId, text: frame.data }
                : { tunnelId, binaryBase64: toBase64(frame.data) },
            );
            if (!response.accepted) {
              notifyError(response.error ?? `Tunnel rejected a frame: ${tunnelId}`);
              notifyClose();
              return;
            }
          } catch (error) {
            notifyError(error instanceof Error ? error.message : String(error));
            notifyClose();
            return;
          }
        }
      })();
    };

    const queueFrame = (data: string | Uint8Array | ArrayBuffer): void => {
      if (closed) return;
      outgoingQueue.push({ data });
      if (drainTimer === null) {
        // Micro-batch frames within the same tick; the daemon relays them
        // in order.
        drainTimer = setTimeout(flushOutgoing, 0);
      }
    };

    void (async () => {
      try {
        const openResponse = await carrier.openSshTunnel({
          tunnelId,
          host: connection.host,
          ...(connection.sshPort !== undefined ? { sshPort: connection.sshPort } : {}),
          ...(connection.daemonPort !== undefined ? { daemonPort: connection.daemonPort } : {}),
          authMode: connection.password ? "password" : "key",
          ...(connection.password ? { password: connection.password } : {}),
        });
        if (!openResponse.success) {
          notifyError(openResponse.error ?? "Failed to open the SSH tunnel.");
          notifyClose();
          return;
        }
        tunnelOpen = true;

        unsubscribeEvents = carrier.subscribe(
          (event: Parameters<Parameters<typeof carrier.subscribe>[0]>[0]) => {
            if (event.type === "tunnel.ssh.frame" && event.payload.tunnelId === tunnelId) {
              const { text, binaryBase64 } = event.payload;
              if (typeof text === "string") {
                for (const handler of messageHandlers) handler(text, false);
              } else if (typeof binaryBase64 === "string") {
                const binary = Uint8Array.from(atob(binaryBase64), (c) => c.charCodeAt(0));
                for (const handler of messageHandlers) handler(binary, true);
              }
              return;
            }
            if (event.type === "tunnel.ssh.state" && event.payload.tunnelId === tunnelId) {
              if (event.payload.state === "open") {
                for (const handler of openHandlers) handler();
                return;
              }
              if (event.payload.state === "closed") {
                if (event.payload.error) notifyError(event.payload.error);
                notifyClose();
              }
            }
          },
        );

        // Answer host-key prompts automatically is NOT done here: prompts
        // surface through the UI layer (session context), which calls
        // carrier.respondSshHostKey.
      } catch (error) {
        notifyError(error instanceof Error ? error.message : String(error));
        notifyClose();
      }
    })();

    return {
      send: (data) => {
        if (!tunnelOpen && !closed) {
          queueFrame(data);
          return;
        }
        queueFrame(data);
      },
      close: (code?: number, reason?: string) => {
        if (closed) return;
        closed = true;
        unsubscribeEvents?.();
        unsubscribeEvents = null;
        if (drainTimer !== null) {
          clearTimeout(drainTimer);
          outgoingQueue.length = 0;
        }
        void carrier.closeSshTunnel(tunnelId).catch(() => undefined);
        void code;
        void reason;
      },
      onMessage: (handler) => {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
      },
      onOpen: (handler) => {
        openHandlers.add(handler);
        return () => openHandlers.delete(handler);
      },
      onClose: (handler) => {
        closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      onError: (handler) => {
        errorHandlers.add(handler);
        return () => errorHandlers.delete(handler);
      },
    };
  };
}

/**
 * Picks the carrier for a Remote SSH connection: the first online host that
 * is not itself an SSH tunnel. Returns null when no carrier is connected.
 */
export function findCarrierClient(
  getClient: (serverId: string) => DaemonClient | null,
  hosts: ReadonlyArray<{ serverId: string; connections: ReadonlyArray<{ type: string }> }>,
  statuses: ReadonlyMap<string, string>,
  excludeServerIds: ReadonlySet<string>,
): DaemonClient | null {
  for (const host of hosts) {
    if (excludeServerIds.has(host.serverId)) continue;
    if (host.connections.some((c) => c.type === "remoteSsh")) continue;
    const status = statuses.get(host.serverId);
    if (status !== "online" && status !== "connecting") continue;
    const client = getClient(host.serverId);
    if (client) return client;
  }
  return null;
}
