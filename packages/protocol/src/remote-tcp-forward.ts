import { z } from "zod";

export const REMOTE_TCP_FORWARD_CONNECTION_PREFIX = "tcpf_";
export const REMOTE_TCP_FORWARD_PROTOCOL_VERSION = 1;
export const REMOTE_TCP_FORWARD_MAX_DATA_BYTES = 64 * 1024;
const REMOTE_TCP_FORWARD_MAX_RESET_REASON_BYTES = 1024;

export const RemoteTcpForwardOpenMessageSchema = z
  .object({
    type: z.literal("remote.tcp.open"),
    version: z.literal(REMOTE_TCP_FORWARD_PROTOCOL_VERSION),
    targetPort: z.number().int().min(1).max(65535),
  })
  .strict();

export const RemoteTcpForwardReadyMessageSchema = z
  .object({
    type: z.literal("remote.tcp.ready"),
  })
  .strict();

export const RemoteTcpForwardErrorMessageSchema = z
  .object({
    type: z.literal("remote.tcp.error"),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(1024),
  })
  .strict();

export const RemoteTcpForwardControlMessageSchema = z.discriminatedUnion("type", [
  RemoteTcpForwardOpenMessageSchema,
  RemoteTcpForwardReadyMessageSchema,
  RemoteTcpForwardErrorMessageSchema,
]);

export type RemoteTcpForwardControlMessage = z.infer<typeof RemoteTcpForwardControlMessageSchema>;

export function parseRemoteTcpForwardControlMessage(data: string): RemoteTcpForwardControlMessage {
  return RemoteTcpForwardControlMessageSchema.parse(JSON.parse(data));
}

export enum RemoteTcpForwardFrameOpcode {
  Data = 1,
  Ack = 2,
  Fin = 3,
  Reset = 4,
}

export type RemoteTcpForwardFrame =
  | { opcode: RemoteTcpForwardFrameOpcode.Data; payload: Uint8Array }
  | { opcode: RemoteTcpForwardFrameOpcode.Ack }
  | { opcode: RemoteTcpForwardFrameOpcode.Fin }
  | { opcode: RemoteTcpForwardFrameOpcode.Reset; reason: string };

export function encodeRemoteTcpForwardDataFrame(payload: Uint8Array): Uint8Array {
  if (payload.byteLength < 1 || payload.byteLength > REMOTE_TCP_FORWARD_MAX_DATA_BYTES) {
    throw new Error(
      `Remote TCP DATA payload must contain 1-${REMOTE_TCP_FORWARD_MAX_DATA_BYTES} bytes`,
    );
  }
  const frame = new Uint8Array(1 + payload.byteLength);
  frame[0] = RemoteTcpForwardFrameOpcode.Data;
  frame.set(payload, 1);
  return frame;
}

export function encodeRemoteTcpForwardAckFrame(): Uint8Array {
  return Uint8Array.of(RemoteTcpForwardFrameOpcode.Ack);
}

export function encodeRemoteTcpForwardFinFrame(): Uint8Array {
  return Uint8Array.of(RemoteTcpForwardFrameOpcode.Fin);
}

export function encodeRemoteTcpForwardResetFrame(reason: string): Uint8Array {
  const encoded = new TextEncoder().encode(reason);
  if (encoded.byteLength > REMOTE_TCP_FORWARD_MAX_RESET_REASON_BYTES) {
    throw new Error(
      `Remote TCP RESET reason exceeds ${REMOTE_TCP_FORWARD_MAX_RESET_REASON_BYTES} bytes`,
    );
  }
  const frame = new Uint8Array(1 + encoded.byteLength);
  frame[0] = RemoteTcpForwardFrameOpcode.Reset;
  frame.set(encoded, 1);
  return frame;
}

export function decodeRemoteTcpForwardFrame(bytes: Uint8Array): RemoteTcpForwardFrame | null {
  switch (bytes[0]) {
    case RemoteTcpForwardFrameOpcode.Data:
      if (bytes.byteLength < 2 || bytes.byteLength > REMOTE_TCP_FORWARD_MAX_DATA_BYTES + 1) {
        return null;
      }
      return {
        opcode: RemoteTcpForwardFrameOpcode.Data,
        payload: bytes.slice(1),
      };
    case RemoteTcpForwardFrameOpcode.Ack:
      return bytes.byteLength === 1 ? { opcode: RemoteTcpForwardFrameOpcode.Ack } : null;
    case RemoteTcpForwardFrameOpcode.Fin:
      return bytes.byteLength === 1 ? { opcode: RemoteTcpForwardFrameOpcode.Fin } : null;
    case RemoteTcpForwardFrameOpcode.Reset:
      if (bytes.byteLength > REMOTE_TCP_FORWARD_MAX_RESET_REASON_BYTES + 1) {
        return null;
      }
      try {
        return {
          opcode: RemoteTcpForwardFrameOpcode.Reset,
          reason: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(1)),
        };
      } catch {
        return null;
      }
    default:
      return null;
  }
}
