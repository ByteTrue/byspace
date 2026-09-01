import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  resolveTerminalFontFamily,
  resolveTerminalFontSize,
} from "./terminal-font";

describe("terminal font defaults", () => {
  it("uses the system monospace stack and 14px size", () => {
    expect(resolveTerminalFontFamily(undefined)).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(resolveTerminalFontFamily("   ")).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(DEFAULT_TERMINAL_FONT_FAMILY).toMatch(/^ui-monospace,/);
    expect(resolveTerminalFontSize(undefined)).toBe(14);
    expect(resolveTerminalFontSize(Number.NaN)).toBe(14);
  });

  it("preserves explicit runtime overrides", () => {
    expect(resolveTerminalFontFamily("  Menlo  ")).toBe("Menlo");
    expect(resolveTerminalFontSize(18)).toBe(18);
  });
});
