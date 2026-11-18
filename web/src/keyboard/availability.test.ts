import { describe, expect, it } from "vitest";
import { keyboardShortcutsAvailable } from "./availability";

describe("keyboardShortcutsAvailable", () => {
  it("matches the environments where the shortcut dispatcher runs", () => {
    expect(keyboardShortcutsAvailable(false)).toBe(true);
    expect(keyboardShortcutsAvailable(true)).toBe(false);
  });
});
