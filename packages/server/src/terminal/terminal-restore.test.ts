import { describe, expect, test } from "vitest";

import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
} from "@bytetrue/byspace-protocol/binary-frames/index";
import type { TerminalCell, TerminalState } from "@bytetrue/byspace-protocol/messages";
import {
  encodeTerminalRestoreFrame,
  resolveRestoreAfterOutputOverflow,
  resolveTerminalRestoreSnapshotOptions,
  resolveTerminalSubscriptionSnapshotMode,
} from "./terminal-restore.js";

function terminalRow(text: string, cols = 80): TerminalCell[] {
  return Array.from({ length: cols }, (_, index) => ({
    char: text[index] ?? " ",
  }));
}

function terminalState(text: string): TerminalState {
  return {
    rows: 1,
    cols: 80,
    grid: [terminalRow(text)],
    scrollback: [],
    cursor: { row: 0, col: text.length },
  };
}

describe("terminal restore policy", () => {
  test("uses ready snapshots only for restore-aware subscriptions", () => {
    expect(resolveTerminalSubscriptionSnapshotMode(undefined)).toBe("state");
    expect(resolveTerminalSubscriptionSnapshotMode({ mode: "live" })).toBe("ready");
  });

  test("resolves bounded restore snapshot options", () => {
    expect(resolveTerminalRestoreSnapshotOptions({ mode: "live" })).toBeNull();
    expect(resolveTerminalRestoreSnapshotOptions({ mode: "full-snapshot" })).toBeUndefined();
    expect(resolveTerminalRestoreSnapshotOptions({ mode: "visible-snapshot" })).toEqual({
      scrollbackLines: 200,
    });
    // The cap matches what the headless xterm retains, so a client may ask for all of it.
    expect(
      resolveTerminalRestoreSnapshotOptions({
        mode: "visible-snapshot",
        scrollbackLines: 999,
      }),
    ).toEqual({ scrollbackLines: 999 });
    expect(
      resolveTerminalRestoreSnapshotOptions({
        mode: "visible-snapshot",
        scrollbackLines: 5_000,
      }),
    ).toEqual({ scrollbackLines: 1_000 });
  });

  test("promotes live restore to visible restore after output overflow", () => {
    expect(resolveRestoreAfterOutputOverflow({ mode: "live" })).toEqual({
      mode: "visible-snapshot",
    });
    expect(resolveRestoreAfterOutputOverflow({ mode: "full-snapshot" })).toEqual({
      mode: "full-snapshot",
    });
  });

  test("encodes restore snapshots as restore frames", () => {
    const frame = decodeTerminalStreamFrame(
      encodeTerminalRestoreFrame({
        slot: 4,
        snapshot: {
          state: terminalState("restored"),
          revision: 1,
        },
      }),
    );

    expect(frame?.opcode).toBe(TerminalStreamOpcode.Restore);
    expect(frame?.slot).toBe(4);
    expect(new TextDecoder().decode(frame?.payload ?? new Uint8Array())).toContain("restored");
  });
});
