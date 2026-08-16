import { describe, expect, it } from "vitest";
import {
  REMOTE_TCP_FORWARD_MAX_DATA_BYTES,
  RemoteTcpForwardFrameOpcode,
  decodeRemoteTcpForwardFrame,
  encodeRemoteTcpForwardAckFrame,
  encodeRemoteTcpForwardDataFrame,
  encodeRemoteTcpForwardFinFrame,
  encodeRemoteTcpForwardResetFrame,
  parseRemoteTcpForwardControlMessage,
} from "./remote-tcp-forward.js";

describe("remote TCP forward protocol", () => {
  it("validates the loopback target open handshake", () => {
    expect(
      parseRemoteTcpForwardControlMessage(
        JSON.stringify({ type: "remote.tcp.open", version: 1, targetPort: 3000 }),
      ),
    ).toEqual({ type: "remote.tcp.open", version: 1, targetPort: 3000 });

    expect(() =>
      parseRemoteTcpForwardControlMessage(
        JSON.stringify({
          type: "remote.tcp.open",
          version: 1,
          targetHost: "192.168.1.1",
          targetPort: 3000,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseRemoteTcpForwardControlMessage(
        JSON.stringify({ type: "remote.tcp.open", version: 1, targetPort: 0 }),
      ),
    ).toThrow();
  });

  it("round-trips bounded DATA, ACK, FIN, and RESET frames", () => {
    const payload = Uint8Array.from([0, 1, 2, 255]);
    expect(decodeRemoteTcpForwardFrame(encodeRemoteTcpForwardDataFrame(payload))).toEqual({
      opcode: RemoteTcpForwardFrameOpcode.Data,
      payload,
    });
    expect(decodeRemoteTcpForwardFrame(encodeRemoteTcpForwardAckFrame())).toEqual({
      opcode: RemoteTcpForwardFrameOpcode.Ack,
    });
    expect(decodeRemoteTcpForwardFrame(encodeRemoteTcpForwardFinFrame())).toEqual({
      opcode: RemoteTcpForwardFrameOpcode.Fin,
    });
    expect(decodeRemoteTcpForwardFrame(encodeRemoteTcpForwardResetFrame("target closed"))).toEqual({
      opcode: RemoteTcpForwardFrameOpcode.Reset,
      reason: "target closed",
    });
  });

  it("rejects malformed and oversized frames", () => {
    expect(() => encodeRemoteTcpForwardDataFrame(new Uint8Array(0))).toThrow();
    expect(() =>
      encodeRemoteTcpForwardDataFrame(new Uint8Array(REMOTE_TCP_FORWARD_MAX_DATA_BYTES + 1)),
    ).toThrow();
    expect(
      decodeRemoteTcpForwardFrame(Uint8Array.of(RemoteTcpForwardFrameOpcode.Ack, 1)),
    ).toBeNull();
    expect(decodeRemoteTcpForwardFrame(Uint8Array.of(255))).toBeNull();
  });
});
