// Stand-in for react-native-unistyles. Only the theme-reading half exists: `withUnistyles` and
// `useUnistyles` feed a component props computed from the current theme, which is how shared
// modules tint icons. There is deliberately no StyleSheet: a module that styles React Native
// views fails the build here and gets a web override instead.
import { createElement, useMemo, type ComponentType } from "react";
import { useWindowDimensions } from "react-native";
import type { Theme } from "@/styles/theme";
import { useResolvedColorScheme } from "~/app/color-scheme";
import { useThemeObject } from "~/app/theme-object";

export interface UnistylesMiniRuntime {
  colorScheme: "light" | "dark";
  insets: { top: number; bottom: number; left: number; right: number; ime: number };
  screen: { width: number; height: number };
}

type Mapping<P> = (theme: Theme, rt: UnistylesMiniRuntime) => Partial<P>;

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0, ime: 0 };

export function useUnistyles(): { theme: Theme; rt: UnistylesMiniRuntime } {
  const theme = useThemeObject();
  const colorScheme = useResolvedColorScheme();
  const { width, height } = useWindowDimensions();
  const rt = useMemo(
    () => ({ colorScheme, insets: NO_INSETS, screen: { width, height } }),
    [colorScheme, height, width],
  );
  return { theme, rt };
}

export function withUnistyles<P extends object>(
  Component: ComponentType<P>,
  mapping?: Mapping<P>,
): ComponentType<Partial<P> & { uniProps?: Mapping<P> }> {
  function Themed({ uniProps, ...props }: Partial<P> & { uniProps?: Mapping<P> }) {
    const { theme, rt } = useUnistyles();
    return createElement(Component, {
      ...(props as P),
      ...(mapping ? mapping(theme, rt) : null),
      ...(uniProps ? uniProps(theme, rt) : null),
    });
  }
  Themed.displayName = `withUnistyles(${Component.displayName ?? Component.name ?? "Component"})`;
  return Themed;
}
