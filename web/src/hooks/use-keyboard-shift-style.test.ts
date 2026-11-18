import { describe, expect, it } from "vitest";
import {
  resolveKeyboardShift,
  shouldUseCompactExplorerKeyboardPadding,
} from "./keyboard-shift-policy";

describe("resolveKeyboardShift", () => {
  it("keeps the existing open-keyboard offset behavior", () => {
    expect(
      resolveKeyboardShift({
        rawKeyboardHeight: 320,
        keyboardProgress: 1,
        bottomInset: 24,
      }),
    ).toBe(296);
  });

  it("treats progress zero as closed even when a stale height is reported", () => {
    expect(
      resolveKeyboardShift({
        rawKeyboardHeight: 320,
        keyboardProgress: 0,
        bottomInset: 24,
      }),
    ).toBe(0);
  });
});

describe("shouldUseCompactExplorerKeyboardPadding", () => {
  it("keeps the changes viewport stable while preserving padding for other tabs", () => {
    expect(shouldUseCompactExplorerKeyboardPadding({ isGit: true, explorerTab: "changes" })).toBe(
      false,
    );
    expect(shouldUseCompactExplorerKeyboardPadding({ isGit: true, explorerTab: "files" })).toBe(
      true,
    );
    expect(shouldUseCompactExplorerKeyboardPadding({ isGit: false, explorerTab: "changes" })).toBe(
      true,
    );
  });
});
