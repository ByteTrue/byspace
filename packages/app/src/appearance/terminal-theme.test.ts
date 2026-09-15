import { describe, expect, it } from "vitest";
import { resolveTerminalTheme } from "./terminal-theme";
import { darkClaudeTheme, darkTheme, lightTheme } from "@/styles/theme";
import { toXtermTheme } from "@/utils/to-xterm-theme";

describe("resolveTerminalTheme", () => {
  it("matches the active theme by default", () => {
    expect(resolveTerminalTheme(lightTheme, "match")).toBe(lightTheme);
    expect(resolveTerminalTheme(darkTheme, "match")).toBe(darkTheme);
  });

  it("forces the canonical dark theme when the app is light", () => {
    expect(resolveTerminalTheme(lightTheme, "dark")).toBe(darkTheme);
  });

  it("keeps the active dark variant when the app is already dark", () => {
    expect(resolveTerminalTheme(darkClaudeTheme, "dark")).toBe(darkClaudeTheme);
  });

  it("forces the canonical light theme when the app is dark", () => {
    expect(resolveTerminalTheme(darkTheme, "light")).toBe(lightTheme);
  });

  it("keeps the active light theme when the app is already light", () => {
    expect(resolveTerminalTheme(lightTheme, "light")).toBe(lightTheme);
  });
});

describe("terminal palette independent of the app theme", () => {
  it("keeps a dark terminal background while the app theme is light", () => {
    const resolved = resolveTerminalTheme(lightTheme, "dark");
    const xterm = toXtermTheme(resolved.colors.terminal);

    // The user's scenario: light app, dark terminal.
    expect(lightTheme.colors.terminal.background).toBe("#ffffff");
    expect(xterm.background).toBe(darkTheme.colors.terminal.background);
    expect(xterm.foreground).toBe(darkTheme.colors.terminal.foreground);
    expect(resolved.colorScheme).toBe("dark");
  });

  it("keeps a light terminal background while the app theme is dark", () => {
    const resolved = resolveTerminalTheme(darkTheme, "light");
    const xterm = toXtermTheme(resolved.colors.terminal);

    expect(xterm.background).toBe(lightTheme.colors.terminal.background);
    expect(resolved.colorScheme).toBe("light");
  });
});
