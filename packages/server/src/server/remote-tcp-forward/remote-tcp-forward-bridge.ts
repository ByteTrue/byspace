import type { Socket } from "node:net";
import {
  REMOTE_TCP_FORWARD_MAX_DATA_BYTES,
  RemoteTcpForwardFrameOpcode,
  decodeRemoteTcpForwardFrame,
  encodeRemoteTcpForwardAckFrame,
  encodeRemoteTcpForwardDataFrame,
  encodeRemoteTcpForwardFinFrame,
  encodeRemoteTcpForwardResetFrame,
} from "@bytetrue/byspace-protocol/remote-tcp-forward";

export interface RemoteTcpForwardChannel {
  send(data: string | Uint8Array | ArrayBuffer): void | Promise<void>;
  close(code?: number, reason?: string): void;
  on(event: "message" | "close" | "error", listener: (...args: unknown[]) => void): void;
}

export interface RemoteTcpForwardBridge {
  close(): void;
}

interface PendingAck {
  resolve(): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_ACK_TIMEOUT_MS = 30_000;

export function bridgeRemoteTcpForwardSocket(
  socket: Socket,
  channel: RemoteTcpForwardChannel,
  options: { ackTimeoutMs?: number } = {},
): RemoteTcpForwardBridge {
  const ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  let closed = false;
  let resetting = false;
  let pendingAck: PendingAck | null = null;
  let incomingTail = Promise.resolve();
  let outgoingTail = Promise.resolve();
  let localReadableEnded = false;

  const rejectPendingAck = (error: Error) => {
    const pending = pendingAck;
    pendingAck = null;
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.reject(error);
  };

  const close = (reason = "Remote TCP forward closed", closeChannel = true) => {
    if (closed) return;
    closed = true;
    rejectPendingAck(new Error(reason));
    socket.destroy();
    if (closeChannel) {
      try {
        channel.close(1000, "Remote TCP forward closed");
      } catch {
        // The Relay transport is already terminal.
      }
    }
  };

  const sendResetAndClose = async (reason: string): Promise<void> => {
    try {
      await channel.send(encodeRemoteTcpForwardResetFrame(reason.slice(0, 1024)));
    } catch {
      // The original stream error remains authoritative.
    } finally {
      close(reason);
    }
  };

  const reset = (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (closed || resetting) return;
    resetting = true;
    void sendResetAndClose(reason);
  };

  const waitForAck = async (payload: Uint8Array): Promise<void> => {
    if (pendingAck) {
      throw new Error("Remote TCP forward sent DATA before the previous ACK");
    }
    const ack = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (pendingAck?.timeout !== timeout) return;
        pendingAck = null;
        reject(new Error("Remote TCP forward ACK timed out"));
      }, ackTimeoutMs);
      (timeout as unknown as { unref?: () => void }).unref?.();
      pendingAck = {
        resolve,
        reject: (error) => reject(error),
        timeout,
      };
    });
    try {
      await channel.send(encodeRemoteTcpForwardDataFrame(payload));
      await ack;
    } catch (error) {
      rejectPendingAck(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };

  const sendChunk = async (chunk: Uint8Array) => {
    for (let offset = 0; offset < chunk.byteLength; offset += REMOTE_TCP_FORWARD_MAX_DATA_BYTES) {
      const end = Math.min(offset + REMOTE_TCP_FORWARD_MAX_DATA_BYTES, chunk.byteLength);
      await waitForAck(chunk.subarray(offset, end));
    }
  };

  const writeToSocket = (payload: Uint8Array): Promise<void> =>
    new Promise((resolve, reject) => {
      socket.write(payload, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

  const handleIncoming = async (data: unknown): Promise<void> => {
    const bytes = asUint8Array(data);
    if (!bytes) {
      throw new Error("Remote TCP forward received a non-binary data frame");
    }
    const frame = decodeRemoteTcpForwardFrame(bytes);
    if (!frame) {
      throw new Error("Remote TCP forward received a malformed frame");
    }

    switch (frame.opcode) {
      case RemoteTcpForwardFrameOpcode.Data:
        await writeToSocket(frame.payload);
        await channel.send(encodeRemoteTcpForwardAckFrame());
        return;
      case RemoteTcpForwardFrameOpcode.Ack: {
        const pending = pendingAck;
        if (!pending) {
          throw new Error("Remote TCP forward received an unexpected ACK");
        }
        pendingAck = null;
        clearTimeout(pending.timeout);
        pending.resolve();
        return;
      }
      case RemoteTcpForwardFrameOpcode.Fin:
        socket.end();
        return;
      case RemoteTcpForwardFrameOpcode.Reset:
        close(frame.reason || "Remote TCP forward reset");
    }
  };

  channel.on("message", (data) => {
    incomingTail = incomingTail
      .then(() => handleIncoming(data))
      .catch((error) => {
        reset(error);
      });
  });
  channel.on("close", (...args) => {
    const reason = typeof args[1] === "string" ? args[1] : "Relay channel closed";
    close(reason, false);
  });
  channel.on("error", (error) => {
    close(error instanceof Error ? error.message : "Relay channel error", false);
  });
  const appendOutgoingChunk = async (previous: Promise<void>, rawChunk: Buffer): Promise<void> => {
    try {
      await previous;
      await sendChunk(rawChunk);
      if (!closed && !localReadableEnded) socket.resume();
    } catch (error) {
      reset(error);
    }
  };
  const queueOutgoingChunk = (rawChunk: Buffer) => {
    socket.pause();
    outgoingTail = appendOutgoingChunk(outgoingTail, rawChunk);
  };
  const appendOutgoingFin = async (previous: Promise<void>): Promise<void> => {
    try {
      await previous;
      if (!closed) await channel.send(encodeRemoteTcpForwardFinFrame());
    } catch (error) {
      reset(error);
    }
  };
  const queueOutgoingFin = () => {
    localReadableEnded = true;
    outgoingTail = appendOutgoingFin(outgoingTail);
  };

  socket.on("data", queueOutgoingChunk);
  socket.once("end", queueOutgoingFin);
  socket.once("error", (error) => reset(error));
  socket.once("close", () => close("TCP socket closed"));

  return { close: () => close() };
}

function asUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
