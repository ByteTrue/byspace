import { describe, expect, it } from "vitest";
import { decodeBinaryFrame } from "./demux.js";
import {
  decodeTunnelFrame,
  encodeTunnelFrame,
  TunnelFrameOpcode,
  type TunnelDataFrame,
} from "./tunnel.js";

describe("tunnel binary frames", () => {
  it("round-trips upstream data frames with empty and non-empty payloads", () => {
    for (const payload of [new Uint8Array(0), new Uint8Array([1, 2, 3, 0xff])]) {
      const bytes = encodeTunnelFrame({
        opcode: TunnelFrameOpcode.DataUpstream,
        tunnelId: "tunnel-1",
        payload,
      });
      const frame = decodeTunnelFrame(bytes) as TunnelDataFrame;
      expect(frame).not.toBeNull();
      expect(frame.opcode).toBe(TunnelFrameOpcode.DataUpstream);
      expect(frame.tunnelId).toBe("tunnel-1");
      expect(Array.from(frame.payload)).toEqual(Array.from(payload));
    }
  });

  it("round-trips downstream data frames", () => {
    const bytes = encodeTunnelFrame({
      opcode: TunnelFrameOpcode.DataDownstream,
      tunnelId: "t2",
      payload: "hello",
    });
    const frame = decodeTunnelFrame(bytes) as TunnelDataFrame;
    expect(frame.opcode).toBe(TunnelFrameOpcode.DataDownstream);
    expect(frame.tunnelId).toBe("t2");
    expect(new TextDecoder().decode(frame.payload)).toBe("hello");
  });

  it("round-trips close frames without payload", () => {
    const bytes = encodeTunnelFrame({ opcode: TunnelFrameOpcode.Close, tunnelId: "t3" });
    const frame = decodeTunnelFrame(bytes);
    expect(frame).toEqual({ opcode: TunnelFrameOpcode.Close, tunnelId: "t3" });
  });

  it("decodes payload as a copy, not a view of the input", () => {
    const bytes = encodeTunnelFrame({
      opcode: TunnelFrameOpcode.DataUpstream,
      tunnelId: "t4",
      payload: new Uint8Array([9, 9, 9]),
    });
    const frame = decodeTunnelFrame(bytes) as TunnelDataFrame;
    bytes.fill(0);
    expect(Array.from(frame.payload)).toEqual([9, 9, 9]);
  });

  it("rejects truncated, empty-id, and unknown-opcode frames", () => {
    expect(decodeTunnelFrame(new Uint8Array(0))).toBeNull();
    expect(decodeTunnelFrame(new Uint8Array([TunnelFrameOpcode.DataUpstream]))).toBeNull();
    // tunnelId length 0
    expect(decodeTunnelFrame(new Uint8Array([TunnelFrameOpcode.DataUpstream, 0, 1, 2]))).toBeNull();
    // truncated tunnelId
    expect(decodeTunnelFrame(new Uint8Array([TunnelFrameOpcode.DataUpstream, 4, 1, 2]))).toBeNull();
    expect(decodeTunnelFrame(new Uint8Array([0x7f, 1, 65]))).toBeNull();
  });

  it("demuxes tunnel frames alongside terminal and file-transfer frames", () => {
    const bytes = encodeTunnelFrame({
      opcode: TunnelFrameOpcode.DataDownstream,
      tunnelId: "mux",
      payload: new Uint8Array([7]),
    });
    const decoded = decodeBinaryFrame(bytes);
    expect(decoded?.kind).toBe("tunnel");
    expect(decoded && decoded.kind === "tunnel" ? decoded.frame.tunnelId : null).toBe("mux");
  });
});
