// Whether a route is the one on screen. The workspace kept mounted under a pushed screen
// (Settings, History...) is not focused (~/app/workspace-layer.tsx), as a stack screen under
// another was not in the Expo app; code in it must not navigate or poll while covered.
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

/** Runs while the route is focused and cleans up when it loses focus. */
export function useFocusEffect(effect: EffectCallback): void {
  const focused = useIsFocused();
  useEffect(() => (focused ? effect() : undefined), [effect, focused]);
}
