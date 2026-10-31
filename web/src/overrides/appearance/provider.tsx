// Override of packages/app/src/appearance/provider.tsx. The Expo version patches Unistyles themes;
// here the same settings land on <html>: `dark` plus a variant class pick the palette
// (index.css, styles/themes.css), and CSS variables carry the type settings.
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { DEFAULT_UI_BASE_FONT_SIZE, useAppSettings, type AppSettings } from "@/hooks/use-settings";

const DARK_VARIANT_CLASSES: Partial<Record<AppSettings["theme"], string>> = {
  zinc: "theme-zinc",
  midnight: "theme-midnight",
  claude: "theme-claude",
  ghostty: "theme-ghostty",
  pureBlack: "theme-pure-black",
};

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
function subscribeSystemScheme(onChange: () => void) {
  const query = darkQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const readSystemDark = () => darkQuery().matches;

function setOptionalProperty(name: string, value: string) {
  if (value) document.documentElement.style.setProperty(name, value);
  else document.documentElement.style.removeProperty(name);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings, isLoading } = useAppSettings();
  const systemDark = useSyncExternalStore(subscribeSystemScheme, readSystemDark, readSystemDark);
  // Until settings load, follow the system, which is also the default preference.
  const theme = isLoading ? "auto" : settings.theme;

  useEffect(() => {
    const root = document.documentElement;
    const dark = theme === "auto" ? systemDark : theme !== "light";
    root.classList.toggle("dark", dark);
    for (const [name, className] of Object.entries(DARK_VARIANT_CLASSES)) {
      root.classList.toggle(className, theme === name);
    }
    root.style.colorScheme = dark ? "dark" : "light";
  }, [systemDark, theme]);

  useEffect(() => {
    if (isLoading) return;
    const root = document.documentElement;
    root.style.setProperty(
      "--ui-font-scale",
      String(settings.uiBaseFontSize / DEFAULT_UI_BASE_FONT_SIZE),
    );
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

  return children;
}
