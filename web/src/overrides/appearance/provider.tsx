// Override of packages/app/src/appearance/provider.tsx. The Expo version patches Unistyles themes;
// here the same settings land on <html>: `dark` plus a variant class pick the palette
// (index.css, styles/themes.css), and CSS variables carry the type settings.
import { type ReactNode, useEffect, useMemo } from "react";
import { resolveSyntaxColors } from "@bytetrue/highlight";
import { DEFAULT_UI_BASE_FONT_SIZE, useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { useResolvedColorScheme } from "~/app/color-scheme";
import { useThemeObject } from "~/app/theme-object";

const DARK_VARIANT_CLASSES: Partial<Record<AppSettings["theme"], string>> = {
  zinc: "theme-zinc",
  midnight: "theme-midnight",
  claude: "theme-claude",
  ghostty: "theme-ghostty",
  pureBlack: "theme-pure-black",
};

function setOptionalProperty(name: string, value: string) {
  if (value) document.documentElement.style.setProperty(name, value);
  else document.documentElement.style.removeProperty(name);
}

// Tailwind's text steps in web/ (index.css) and their size at the default 14px interface.
const UI_TEXT_STEPS = [
  ["xs", 12],
  ["sm", 14],
  ["base", 16],
  ["lg", 18],
  ["xl", 20],
  ["2xl", 24],
] as const;

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings, isLoading } = useAppSettings();
  const scheme = useResolvedColorScheme();
  const theme = isLoading ? "auto" : settings.theme;
  const themeObject = useThemeObject();
  const themeColors = themeObject.colors;
  // The code palette is its own setting; only its light/dark side follows the app theme.
  const syntax = useMemo(
    () => resolveSyntaxColors(settings.syntaxTheme, themeObject.colorScheme),
    [settings.syntaxTheme, themeObject.colorScheme],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", scheme === "dark");
    for (const [name, className] of Object.entries(DARK_VARIANT_CLASSES)) {
      root.classList.toggle(className, theme === name);
    }
    root.style.colorScheme = scheme;
  }, [scheme, theme]);

  useEffect(() => {
    if (isLoading) return;
    const root = document.documentElement;
    // packages/app's scaleFontSize (appearance/apply.ts): each step scaled from 14px and rounded
    // to a whole pixel, so a 12px interface makes the 12px step 10px, not 10.29px.
    const ratio = settings.uiBaseFontSize / DEFAULT_UI_BASE_FONT_SIZE;
    for (const [step, size] of UI_TEXT_STEPS) {
      root.style.setProperty(`--ui-text-${step}`, `${Math.round(size * ratio)}px`);
    }
    root.style.setProperty("--content-font-size", `${settings.contentFontSize}px`);
    root.style.setProperty("--code-font-size", `${settings.codeFontSize}px`);
    setOptionalProperty("--app-font-sans", settings.uiFontFamily.trim());
    setOptionalProperty("--app-font-mono", settings.monoFontFamily.trim());
  }, [
    isLoading,
    settings.uiBaseFontSize,
    settings.contentFontSize,
    settings.codeFontSize,
    settings.uiFontFamily,
    settings.monoFontFamily,
  ]);

  // Code views read the palette as --syntax-<token> (styles/syntax-token-styles.ts).
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(syntax)) {
      root.style.setProperty(`--syntax-${name}`, value);
    }
  }, [syntax]);

  // The two raised steps shadcn has no name for (skeleton bars, pressed fills).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--surface-3", themeColors.surface3);
    root.style.setProperty("--surface-4", themeColors.surface4);
  }, [themeColors.surface3, themeColors.surface4]);

  return children;
}
