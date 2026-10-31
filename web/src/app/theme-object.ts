import { useMemo } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { darkTheme, lightTheme, THEME_OPTIONS, type Theme } from "@/styles/theme";
import { useResolvedColorScheme } from "~/app/color-scheme";

/**
 * The packages/app theme object for the current appearance setting. Shared modules that tint
 * icons through Unistyles read their colours from it (web/src/shims/react-native-unistyles.tsx);
 * its colour tokens are the same values as the CSS variables in index.css.
 */
export function useThemeObject(): Theme {
  const { settings, isLoading } = useAppSettings();
  const scheme = useResolvedColorScheme();
  const preference = isLoading ? "auto" : settings.theme;
  return useMemo(() => {
    if (preference === "auto") return scheme === "dark" ? darkTheme : lightTheme;
    for (const option of THEME_OPTIONS) {
      if (option.name === preference && "theme" in option) return option.theme;
    }
    return darkTheme;
  }, [preference, scheme]);
}
