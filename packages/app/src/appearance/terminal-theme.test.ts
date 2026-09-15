import { describe, expect, it } from "vitest";
import { resolveTerminalTheme } from "./terminal-theme";
import { darkClaudeTheme, darkTheme, lightTheme } from "@/styles/theme";

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
