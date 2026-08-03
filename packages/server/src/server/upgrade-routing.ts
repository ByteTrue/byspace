import type { IncomingMessage, Server as HTTPServer } from "node:http";
import type { Duplex } from "node:stream";

/**
 * One daemon port carries two kinds of WebSocket: the daemon's own protocol
 * socket and whatever a proxied workspace service speaks on its own hostname.
 * Node runs every "upgrade" listener, so the owners have to agree explicitly —
 * the service proxy marks what it took, and this router leaves those alone.
 */
const CLAIMED_UPGRADE = Symbol("byspace.claimedUpgrade");

type ClaimableRequest = IncomingMessage & { [CLAIMED_UPGRADE]?: true };

export function markUpgradeClaimed(req: IncomingMessage): void {
  (req as ClaimableRequest)[CLAIMED_UPGRADE] = true;
}

export function isUpgradeClaimed(req: IncomingMessage): boolean {
  return (req as ClaimableRequest)[CLAIMED_UPGRADE] === true;
}

function requestPathname(url: string | undefined): string {
  const target = url ?? "/";
  const queryIndex = target.indexOf("?");
  return queryIndex === -1 ? target : target.slice(0, queryIndex);
}

export function attachDaemonUpgradeRouting(params: {
  server: HTTPServer;
  path: string;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}): void {
  const { server, path, handleUpgrade } = params;
  server.on("upgrade", (req, socket, head) => {
    // Ownership before path: a proxied dev server has its own idea of which
    // path carries HMR, and Vite's happens to be "/ws" too.
    if (isUpgradeClaimed(req)) {
      return;
    }
    if (requestPathname(req.url) === path) {
      handleUpgrade(req, socket, head);
      return;
    }
    // Nobody owns this one. `ws` used to answer here, and its 400 is what
    // clients already expect from an unknown upgrade target.
    socket.write(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/html\r\nContent-Length: 11\r\n\r\nBad Request",
    );
    socket.destroy();
  });
}
