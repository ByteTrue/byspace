import { describe, expect, it } from "vitest";
import {
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  LINE_HEIGHT,
  REGISTERED_THEMES,
  THEME_OPTIONS,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 14,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
    expect(LINE_HEIGHT.diff).toBe(21);
  });
});

describe("Theme catalog", () => {
  it("owns the three built-in picker and shortcut choices", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual(["light", "dark", "auto"]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("auto")).toBe("light");
  });

  it("retains the two plugin registry slots", () => {
    expect(Object.keys(REGISTERED_THEMES)).toEqual(["light", "dark", "pluginLight", "pluginDark"]);
  });
});

describe("Sidebar interaction surfaces", () => {
  it("keeps Light selection distinct from the sidebar surface", () => {
    expect(lightTheme.colors.surfaceSidebarHover).toBe(lightTheme.colors.surface1);
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface3);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
  });

  it("derives Dark hover and selection from the first two raised surfaces", () => {
    expect(darkTheme.colors.surfaceSidebarHover).toBe(darkTheme.colors.surface1);
    expect(darkTheme.colors.surfaceSidebarSelected).toBe(darkTheme.colors.surface2);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});
