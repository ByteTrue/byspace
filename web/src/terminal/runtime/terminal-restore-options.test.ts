import { describe, expect, it } from "vitest";

import { resolveTerminalRestoreOptions } from "./terminal-restore-options";

describe("terminal restore options", () => {
  it("requests visible snapshot restore with bounded scrollback", () => {
    expect(
      resolveTerminalRestoreOptions({
        canClaimSize: true,
        canResume: false,
        size: { rows: 24, cols: 80 },
      }),
    ).toEqual({
      mode: "visible-snapshot",
      resume: false,
      scrollbackLines: 1_000,
      size: { rows: 24, cols: 80 },
    });
  });

  it("resumes only when the same renderer still owns the terminal history", () => {
    expect(
      resolveTerminalRestoreOptions({
        canClaimSize: false,
        canResume: true,
        size: { rows: 24, cols: 80 },
      }),
    ).toEqual({
      mode: "visible-snapshot",
      resume: true,
      scrollbackLines: 1_000,
    });
  });

  it("omits size until the terminal has been measured", () => {
    expect(
      resolveTerminalRestoreOptions({
        canClaimSize: true,
        canResume: false,
        size: null,
      }),
    ).toEqual({
      mode: "visible-snapshot",
      resume: false,
      scrollbackLines: 1_000,
    });
  });

  it("does not let a background attach resize the PTY", () => {
    expect(
      resolveTerminalRestoreOptions({
        canClaimSize: false,
        canResume: false,
        size: { rows: 24, cols: 80 },
      }),
    ).toEqual({
      mode: "visible-snapshot",
      resume: false,
      scrollbackLines: 1_000,
    });
  });
});
