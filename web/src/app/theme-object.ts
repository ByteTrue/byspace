import { createElement, useMemo, type ComponentType } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { darkTheme, lightTheme, THEME_OPTIONS, type Theme } from "@/styles/theme";
import { useResolvedColorScheme } from "~/app/color-scheme";

/**
 * The theme object for the current appearance setting, for code that needs a colour as a value
 * (icon tints, canvas painting). Its colour tokens are the same values as the CSS variables in
 * index.css.
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

type ThemeMapping<P> = (theme: Theme) => Partial<P>;

/**
 * The component with props computed from the current theme: `mapping` for every instance,
 * `themeProps` for one. How icons take a theme colour as their `color` prop.
 */
export function withTheme<P extends object>(
  Component: ComponentType<P>,
  mapping?: ThemeMapping<P>,
): ComponentType<Partial<P> & { themeProps?: ThemeMapping<P> }> {
  function Themed({ themeProps, ...props }: Partial<P> & { themeProps?: ThemeMapping<P> }) {
    const theme = useThemeObject();
    return createElement(Component, {
      ...(props as P),
      ...(mapping ? mapping(theme) : null),
      ...(themeProps ? themeProps(theme) : null),
    });
  }
  Themed.displayName = `withTheme(${Component.displayName ?? Component.name ?? "Component"})`;
  return Themed;
}
