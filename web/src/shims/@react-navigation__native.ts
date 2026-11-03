// Stand-in for @react-navigation/native. Only the focus hooks the shared screens call exist. A route
// is focused while it is the one on screen: the workspace kept mounted under a pushed screen
// (Settings, History...) is not (~/app/workspace-layer.tsx), as a stack screen under another is not
// in the Expo app. Anything else fails the build.
import { createContext, createElement, useContext, useEffect, type EffectCallback } from "react";
import type { ReactNode } from "react";

const RouteFocusContext = createContext(true);

export function RouteFocusProvider({
  focused,
  children,
}: {
  focused: boolean;
  children: ReactNode;
}) {
  return createElement(RouteFocusContext.Provider, { value: focused }, children);
}

export function useIsFocused(): boolean {
  return useContext(RouteFocusContext);
}

/** Runs while the route is focused and cleans up when it loses focus, as React Navigation's does. */
export function useFocusEffect(effect: EffectCallback): void {
  const focused = useIsFocused();
  useEffect(() => (focused ? effect() : undefined), [effect, focused]);
}
