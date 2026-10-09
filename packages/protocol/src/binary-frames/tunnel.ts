import { asUint8Array } from "./terminal.js";

/**
 * Binary frames for daemon-to-daemon tunnel byte streams.
 *
 * One tunnelId identifies one forwarded TCP stream (one local listener socket
 * on D1 paired with one outbound TCP socket on D2). Control (open/close/ack)
 * rides the JSON session RPCs in messages.ts; only stream bytes use these
 * frames. Direction: "data" frames flow both ways; "close" signals EOF for
 * one direction and tears down the paired socket.
 *
 * Layout:
 *   [1B opcode][1B tunnelId length][tunnelId utf8][payload...]
 *
 * Opcodes were allocated after the file-transfer block (0x10..0x12).
 */

export const TunnelFrameOpcode = {
  /** Stream bytes for tunnelId, D1→D2 (client to target host). */
  DataUpstream: 0x20,
  /** Stream bytes for tunnelId, D2→D1 (target host to client). */
  DataDownstream: 0x21,
  /** Half-close/teardown for tunnelId. Sender is done with this stream. */
  Close: 0x22,
} as const;

export type TunnelFrameOpcode = (typeof TunnelFrameOpcode)[keyof typeof TunnelFrameOpcode];

export interface TunnelDataFrame {
  opcode: typeof TunnelFrameOpcode.DataUpstream | typeof TunnelFrameOpcode.DataDownstream;
  tunnelId: string;
  payload: Uint8Array;
}

export interface TunnelCloseFrame {
  opcode: typeof TunnelFrameOpcode.Close;
  tunnelId: string;
}

export type TunnelFrame = TunnelDataFrame | TunnelCloseFrame;

export function encodeTunnelFrame(input: {
  opcode: TunnelFrameOpcode;
  tunnelId: string;
  payload?: Uint8Array | ArrayBuffer | string;
}): Uint8Array {
  if (input.tunnelId.length === 0 || input.tunnelId.length > 255) {
    throw new RangeError("tunnelId must be 1..255 bytes");
  }
  const tunnelIdBytes = new TextEncoder().encode(input.tunnelId);
  const payload = asUint8Array(input.payload ?? new Uint8Array()) ?? new Uint8Array();
  const bytes = new Uint8Array(2 + tunnelIdBytes.byteLength + payload.byteLength);
  bytes[0] = input.opcode;
  bytes[1] = tunnelIdBytes.byteLength;
  bytes.set(tunnelIdBytes, 2);
  bytes.set(payload, 2 + tunnelIdBytes.byteLength);
  return bytes;
}

export function decodeTunnelFrame(bytes: Uint8Array): TunnelFrame | null {
  if (bytes.byteLength < 2) return null;
  const opcode = bytes[0] as TunnelFrameOpcode;
  if (
    opcode !== TunnelFrameOpcode.DataUpstream &&
    opcode !== TunnelFrameOpcode.DataDownstream &&
    opcode !== TunnelFrameOpcode.Close
  ) {
    return null;
  }
  const tunnelIdLength = bytes[1];
  if (tunnelIdLength === 0 || bytes.byteLength < 2 + tunnelIdLength) return null;
  const tunnelId = new TextDecoder().decode(bytes.subarray(2, 2 + tunnelIdLength));
  if (opcode === TunnelFrameOpcode.Close) {
    return { opcode, tunnelId };
  }
  // Copy: subarray views the receive buffer, which callers may reuse.
  const payload = new Uint8Array(bytes.subarray(2 + tunnelIdLength));
  return { opcode, tunnelId, payload };
}
