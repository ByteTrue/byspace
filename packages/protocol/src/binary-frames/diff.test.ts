import { describe, expect, it } from "vitest";

import { decodeBinaryFrame, decodeDiffFrame, DiffOpcode, encodeDiffFrame } from "./index.js";

const header = {
  revision: 3,
  cwd: "/repo",
  compare: { mode: "uncommitted" as const },
  resolved: { baseSha: "a", headSha: "b", mergeBaseSha: "c" },
  entries: ["a.txt"],
  error: null,
};

const trailer = { revision: 3, omitted: 0, diffTooLarge: false, error: null };

describe("diff frames", () => {
  it("round-trips Begin and End control frames", () => {
    const begin = decodeDiffFrame(
      encodeDiffFrame({ opcode: DiffOpcode.Begin, subscriptionId: "sub_1", header }),
    );
    expect(begin).toEqual({ opcode: DiffOpcode.Begin, subscriptionId: "sub_1", header });

    const end = decodeDiffFrame(
      encodeDiffFrame({ opcode: DiffOpcode.End, subscriptionId: "sub_1", trailer }),
    );
    expect(end).toEqual({ opcode: DiffOpcode.End, subscriptionId: "sub_1", trailer });
  });

  it("round-trips an empty body list and a body over 64 KiB", () => {
    const empty = decodeDiffFrame(
      encodeDiffFrame({ opcode: DiffOpcode.Bodies, subscriptionId: "sub_1", files: [] }),
    );
    expect(empty).toEqual({ opcode: DiffOpcode.Bodies, subscriptionId: "sub_1", files: [] });

    const large = new Uint8Array(100_000).fill(0x61);
    const framed = decodeDiffFrame(
      encodeDiffFrame({
        opcode: DiffOpcode.Bodies,
        subscriptionId: "sub_1",
        files: [
          { path: "a.txt", body: new TextEncoder().encode("one") },
          { path: "large.txt", body: large },
        ],
      }),
    );
    if (framed?.opcode !== DiffOpcode.Bodies) {
      throw new Error("expected bodies");
    }
    expect(framed.files.map((file) => file.path)).toEqual(["a.txt", "large.txt"]);
    expect(new TextDecoder().decode(framed.files[0]?.body)).toBe("one");
    expect(framed.files[1]?.body.byteLength).toBe(100_000);
  });

  it("demux routes diff frames by opcode", () => {
    expect(
      decodeBinaryFrame(encodeDiffFrame({ opcode: DiffOpcode.End, subscriptionId: "s", trailer })),
    ).toEqual({ kind: "diff", frame: { opcode: DiffOpcode.End, subscriptionId: "s", trailer } });
  });

  it("rejects an invalid trailer instead of delivering it", () => {
    const bytes = encodeDiffFrame({ opcode: DiffOpcode.End, subscriptionId: "s", trailer });
    const idLength = bytes[1] ?? 0;
    const invalid = new TextEncoder().encode('{"revision":3}');
    const broken = new Uint8Array(2 + idLength + invalid.byteLength);
    broken.set(bytes.subarray(0, 2 + idLength));
    broken.set(invalid, 2 + idLength);
    expect(decodeDiffFrame(broken)).toBeNull();
  });

  it("rejects a truncated body list", () => {
    const bytes = encodeDiffFrame({
      opcode: DiffOpcode.Bodies,
      subscriptionId: "s",
      files: [{ path: "a.txt", body: new TextEncoder().encode("one") }],
    });
    expect(decodeDiffFrame(bytes.subarray(0, bytes.byteLength - 2))).toBeNull();
  });
});
