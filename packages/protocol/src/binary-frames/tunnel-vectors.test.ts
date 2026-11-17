import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeTunnelFrame, encodeTunnelFrame, type TunnelDataFrame } from "./tunnel.js";

// Shared wire-layout vectors, also read by Go in internal/tunnel/frame_vectors_test.go. The layout
// [1B opcode][1B idLen][id utf8][payload] and the three opcodes TS decodes (DataUpstream 0x20,
// DataDownstream 0x21, Close 0x22) are locked here; a change in either codec the other does not
// follow fails on both sides. frameHex comes from the layout spec, not from either codec's output.
interface Vectors {
  valid: { name: string; opcode: number; tunnelId: string; payloadHex: string; frameHex: string }[];
  encodeReject: {
    name: string;
    opcode: number;
    tunnelId: string;
    payloadHex: string;
    why: string;
  }[];
  invalid: { name: string; frameHex: string }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(new URL("./tunnel-vectors.json", import.meta.url), "utf8"),
);

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("tunnel shared frame vectors", () => {
  it("has vectors to lock", () => {
    expect(vectors.valid.length).toBeGreaterThan(0);
    expect(vectors.invalid.length).toBeGreaterThan(0);
  });

  for (const v of vectors.valid) {
    it(`decodes ${v.name} byte-for-byte`, () => {
      const frame = decodeTunnelFrame(fromHex(v.frameHex));
      expect(frame).not.toBeNull();
      expect(frame!.opcode).toBe(v.opcode);
      expect(frame!.tunnelId).toBe(v.tunnelId);
      if (frame!.opcode === 0x22) {
        expect("payload" in frame!).toBe(false);
      } else {
        expect(toHex((frame as TunnelDataFrame).payload)).toBe(v.payloadHex);
      }
    });

    it(`encodes ${v.name} byte-for-byte`, () => {
      const payload = v.opcode === 0x22 ? undefined : fromHex(v.payloadHex);
      const bytes = encodeTunnelFrame({
        opcode: v.opcode as 0x20 | 0x21 | 0x22,
        tunnelId: v.tunnelId,
        payload,
      });
      expect(toHex(bytes)).toBe(v.frameHex);
    });
  }

  for (const v of vectors.encodeReject) {
    it(`refuses to encode ${v.name}`, () => {
      expect(() =>
        encodeTunnelFrame({
          opcode: v.opcode as 0x20 | 0x21 | 0x22,
          tunnelId: v.tunnelId,
          payload: fromHex(v.payloadHex),
        }),
      ).toThrow(RangeError);
    });
  }

  for (const v of vectors.invalid) {
    it(`rejects invalid ${v.name}`, () => {
      expect(decodeTunnelFrame(fromHex(v.frameHex))).toBeNull();
    });
  }
});
