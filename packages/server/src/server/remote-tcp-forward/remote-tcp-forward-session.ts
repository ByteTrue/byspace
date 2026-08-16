import { Socket } from "node:net";
import {
  REMOTE_TCP_FORWARD_PROTOCOL_VERSION,
  parseRemoteTcpForwardControlMessage,
  type RemoteTcpForwardControlMessage,
} from "@bytetrue/byspace-protocol/remote-tcp-forward";
import {
  bridgeRemoteTcpForwardSocket,
  type RemoteTcpForwardChannel,
} from "./remote-tcp-forward-bridge.js";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const LOOPBACK_CONNECT_TIMEOUT_MS = 5_000;
const MAX_TARGET_CHANNELS = 256;
let activeTargetChannels = 0;

interface SessionOptions {
  handshakeTimeoutMs?: number;
}

export async function openRemoteTcpForwardChannel(
  channel: RemoteTcpForwardChannel,
  targetPort: number,
  options: SessionOptions = {},
): Promise<void> {
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    throw new Error("Remote TCP target port must be an integer between 1 and 65535");
  }

  const response = waitForControlMessage(channel, options.handshakeTimeoutMs);
  await channel.send(
    JSON.stringify({
      type: "remote.tcp.open",
      version: REMOTE_TCP_FORWARD_PROTOCOL_VERSION,
      targetPort,
    }),
  );
  const message = await response;
  if (message.type === "remote.tcp.error") {
    throw new Error(message.message);
  }
  if (message.type !== "remote.tcp.ready") {
    throw new Error("Remote host returned an invalid TCP forward handshake");
  }
}

export async function acceptRemoteTcpForwardChannel(
  channel: RemoteTcpForwardChannel,
  options: SessionOptions = {},
): Promise<void> {
  if (activeTargetChannels >= MAX_TARGET_CHANNELS) {
    channel.close(1013, "Remote TCP forward target is at capacity");
    return;
  }
  activeTargetChannels += 1;
  try {
    let socket: Socket;
    try {
      const message = await waitForControlMessage(channel, options.handshakeTimeoutMs);
      if (message.type !== "remote.tcp.open") {
        throw new Error("Remote TCP forward expected an open request");
      }
      socket = await connectLoopback(message.targetPort);
      await channel.send(JSON.stringify({ type: "remote.tcp.ready" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remote TCP forward failed";
      await Promise.resolve(
        channel.send(
          JSON.stringify({
            type: "remote.tcp.error",
            code: "TARGET_UNAVAILABLE",
            message,
          }),
        ),
      ).catch(() => undefined);
      channel.close(1008, "Remote TCP forward rejected");
      return;
    }

    bridgeRemoteTcpForwardSocket(socket, channel);
    await new Promise<void>((resolve) => {
      channel.on("close", () => resolve());
    });
  } finally {
    activeTargetChannels -= 1;
  }
}

function waitForControlMessage(
  channel: RemoteTcpForwardChannel,
  timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
): Promise<RemoteTcpForwardControlMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      settle(() => reject(new Error("Remote TCP forward handshake timed out")));
    }, timeoutMs);
    (timeout as unknown as { unref?: () => void }).unref?.();

    channel.on("message", (data) => {
      if (settled) return;
      if (typeof data !== "string") {
        settle(() => reject(new Error("Remote TCP forward expected a control message")));
        return;
      }
      try {
        const parsed = parseRemoteTcpForwardControlMessage(data);
        settle(() => resolve(parsed));
      } catch {
        settle(() => reject(new Error("Remote TCP forward received an invalid control message")));
      }
    });
    channel.on("close", () => {
      settle(() => reject(new Error("Remote TCP forward channel closed during handshake")));
    });
    channel.on("error", (error) => {
      settle(() =>
        reject(error instanceof Error ? error : new Error("Remote TCP forward channel failed")),
      );
    });
  });
}

async function connectLoopback(targetPort: number): Promise<Socket> {
  let firstError: Error | null = null;
  for (const host of ["127.0.0.1", "::1"]) {
    try {
      return await connectHost(host, targetPort);
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(`Remote loopback port ${targetPort} is unavailable`, { cause: firstError });
}

function connectHost(host: string, targetPort: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket({ allowHalfOpen: true });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Loopback connection to ${host}:${targetPort} timed out`));
    }, LOOPBACK_CONNECT_TIMEOUT_MS);
    (timeout as unknown as { unref?: () => void }).unref?.();
    const fail = (error: Error) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.connect(targetPort, host, () => {
      clearTimeout(timeout);
      socket.off("error", fail);
      socket.setNoDelay(true);
      resolve(socket);
    });
  });
}
