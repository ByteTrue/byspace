import { describe, expect, it } from "vitest";
import {
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  THEME_OPTIONS,
  withAlpha,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("light");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses BySpace's accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#ffffff");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#ffffff");
  });

  it("derives sidebar interaction surfaces from the surface scale", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(darkPureBlackTheme.colors.surface2);
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe(
      darkPureBlackTheme.colors.surface2,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Sidebar interaction surfaces", () => {
  // shadcn/ui sidebar: hover and the selected row share sidebar-accent; the selected row is told
  // apart by its indicator bar, not by a darker fill.
  it("uses one accent surface for hover and selection, distinct from the sidebar", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.colors.surfaceSidebarHover).toBe(theme.colors.surface2);
      expect(theme.colors.surfaceSidebarSelected).toBe(theme.colors.surface2);
      expect(theme.colors.surfaceSidebarSelected).not.toBe(theme.colors.surfaceSidebar);
    }
  });
});

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(
      (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
    );
    const linear = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Composites an `rgba(r, g, b, a)` token over an opaque `#rrggbb` surface. */
function flatten(rgba: string, surface: string): string {
  const [r, g, b, a] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
  const base = [1, 3, 5].map((index) => Number.parseInt(surface.slice(index, index + 2), 16));
  return `#${[r, g, b]
    .map((channel, index) => Math.round(a * channel + (1 - a) * base[index]))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("text contrast", () => {
  it("keeps muted text at 4.5:1 or better on every surface it sits on", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const { foregroundMuted, surface0, surface2, surfaceSidebar } = theme.colors;
      for (const surface of [surface0, surface2, surfaceSidebar]) {
        expect(contrastRatio(foregroundMuted, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps destructive button text at 4.5:1 or better on its tinted fill", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const { destructiveSoft, destructiveSoftForeground, popover } = theme.colors;
      const fill = flatten(destructiveSoft, popover);
      expect(contrastRatio(destructiveSoftForeground, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("shadcn/ui neutral palette", () => {
  it("maps the light neutral tokens", () => {
    expect(lightTheme.colors).toMatchObject({
      surface0: "#ffffff",
      surface2: "#f5f5f5",
      surfaceSidebar: "#fafafa",
      foreground: "#0a0a0a",
      foregroundMuted: "#6e6e6e",
      border: "#e5e5e5",
      input: "#e5e5e5",
      accent: "#171717",
      ring: "#a1a1a1",
      focusRing: "rgba(161, 161, 161, 0.5)",
    });
  });

  it("maps the dark neutral tokens with the inset sidebar lighter than the workspace", () => {
    expect(darkTheme.colors).toMatchObject({
      surface0: "#0a0a0a",
      surfaceSidebar: "#171717",
      foreground: "#fafafa",
      foregroundMuted: "#a1a1a1",
      border: "rgba(255, 255, 255, 0.1)",
      accent: "#e5e5e5",
      accentForeground: "#171717",
    });
  });

  it("inverts the tooltip against the surface", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.colors.tooltip).toBe(theme.colors.foreground);
      expect(theme.colors.tooltipForeground).toBe(theme.colors.surface0);
    }
  });
});

describe("withAlpha", () => {
  it("turns #rrggbb into rgba and rejects anything else", () => {
    expect(withAlpha("#171717", 0.8)).toBe("rgba(23, 23, 23, 0.8)");
    expect(() => withAlpha("rgba(0, 0, 0, 1)", 0.5)).toThrow();
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#171717",
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
