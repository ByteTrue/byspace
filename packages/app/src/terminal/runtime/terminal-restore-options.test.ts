import { describe, expect, it } from "vitest";

import { resolveTerminalRestoreOptions } from "./terminal-restore-options";

describe("terminal restore options", () => {
  it("omits restore options for daemons without terminal restore modes", () => {
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: false,
        size: { rows: 24, cols: 80 },
        canResume: false,
      }),
    ).toBeUndefined();
  });

  it("asks to resume when this renderer still holds the stream", () => {
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: true,
        size: { rows: 24, cols: 80 },
        canResume: true,
      }),
    ).toEqual({
      resume: true,
      mode: "visible-snapshot",
      scrollbackLines: 1_000,
      size: { rows: 24, cols: 80 },
    });
  });

  it("takes the snapshot when the renderer is new, even though the daemon may remember us", () => {
    // A reload keeps the daemon session and its record of what it sent, but the
    // renderer it sent that to is gone.
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: true,
        size: { rows: 24, cols: 80 },
        canResume: false,
      }),
    ).toEqual({
      mode: "visible-snapshot",
      scrollbackLines: 1_000,
      size: { rows: 24, cols: 80 },
    });
  });

  it("omits size until the terminal has been measured", () => {
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: true,
        size: null,
        canResume: true,
      }),
    ).toEqual({
      resume: true,
      mode: "visible-snapshot",
      scrollbackLines: 1_000,
    });
  });
});
