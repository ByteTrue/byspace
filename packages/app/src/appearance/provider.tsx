import { type ReactNode, useEffect } from "react";
import { UnistylesRuntime } from "react-native-unistyles";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { THEME_TO_UNISTYLES } from "@/styles/theme";
import { applyAppearance } from "./apply";

interface ApplyThemeInput {
  preference: AppSettings["theme"];
}

function applyTheme({ preference }: ApplyThemeInput): void {
  if (preference === "auto") {
    UnistylesRuntime.setAdaptiveThemes(true);
    return;
  }

  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(THEME_TO_UNISTYLES[preference]);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings, isLoading } = useAppSettings();

  useEffect(() => {
    if (isLoading) return;
    applyTheme({ preference: settings.theme });
    applyAppearance({
      uiFontFamily: settings.uiFontFamily,
      monoFontFamily: settings.monoFontFamily,
      uiBaseFontSize: settings.uiBaseFontSize,
      contentFontSize: settings.contentFontSize,
      codeFontSize: settings.codeFontSize,
      syntaxTheme: settings.syntaxTheme,
    });
  }, [
    isLoading,
    settings.theme,
    settings.uiFontFamily,
    settings.monoFontFamily,
    settings.uiBaseFontSize,
    settings.contentFontSize,
    settings.codeFontSize,
    settings.syntaxTheme,
  ]);

  return children;
}
