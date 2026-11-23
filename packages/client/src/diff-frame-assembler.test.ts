import { describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@bytetrue/protocol/messages";
import {
  DiffOpcode,
  encodeDiffFrame,
  serializeDiffBody,
  decodeDiffFrame,
} from "@bytetrue/protocol/binary-frames/index";
import { DiffFrameAssembler } from "./diff-frame-assembler.js";

function file(path: string, additions: number): ParsedDiffFile {
  return { path, isNew: false, isDeleted: false, additions, deletions: 0, hunks: [] };
}

function revision(
  assembler: DiffFrameAssembler,
  subscriptionId: string,
  rev: number,
  entries: string[],
  bodies: ParsedDiffFile[],
) {
  const compare = { mode: "uncommitted" as const };
  const frames = [
    encodeDiffFrame({
      opcode: DiffOpcode.Begin,
      subscriptionId,
      header: {
        revision: rev,
        cwd: "/repo",
        compare,
        resolved: { baseSha: "a", headSha: "b", mergeBaseSha: "c" },
        entries,
        error: null,
      },
    }),
    encodeDiffFrame({
      opcode: DiffOpcode.Bodies,
      subscriptionId,
      files: bodies.map((body) => ({ path: body.path, body: serializeDiffBody(body) })),
    }),
    encodeDiffFrame({
      opcode: DiffOpcode.End,
      subscriptionId,
      trailer: { revision: rev, omitted: 0, diffTooLarge: false, error: null },
    }),
  ];
  let delivered: ReturnType<DiffFrameAssembler["push"]> = null;
  for (const bytes of frames) {
    const frame = decodeDiffFrame(bytes);
    if (!frame) {
      throw new Error("frame did not decode");
    }
    delivered = assembler.push(frame) ?? delivered;
  }
  if (!delivered) {
    throw new Error("revision was not delivered");
  }
  return delivered.payload;
}

describe("DiffFrameAssembler", () => {
  it("keeps the untouched files of the previous revision", () => {
    const assembler = new DiffFrameAssembler();
    const first = revision(
      assembler,
      "sub",
      1,
      ["a.txt", "b.txt"],
      [file("a.txt", 1), file("b.txt", 1)],
    );
    const untouched = first.files.find((entry) => entry.path === "b.txt");

    const second = revision(assembler, "sub", 2, ["a.txt", "b.txt"], [file("a.txt", 2)]);

    expect(second.files.map((entry) => [entry.path, entry.additions])).toEqual([
      ["a.txt", 2],
      ["b.txt", 1],
    ]);
    expect(second.files.find((entry) => entry.path === "b.txt")).toBe(untouched);
  });

  it("drops a removed path and refuses a mismatched revision", () => {
    const assembler = new DiffFrameAssembler();
    revision(assembler, "sub", 1, ["a.txt", "b.txt"], [file("a.txt", 1), file("b.txt", 1)]);
    const second = revision(assembler, "sub", 2, ["a.txt"], [file("a.txt", 2)]);
    expect(second.files.map((entry) => entry.path)).toEqual(["a.txt"]);

    const stale = assembler.push({
      opcode: DiffOpcode.End,
      subscriptionId: "sub",
      trailer: { revision: 99, omitted: 0, diffTooLarge: false, error: null },
    });
    expect(stale).toBeNull();
  });
});
