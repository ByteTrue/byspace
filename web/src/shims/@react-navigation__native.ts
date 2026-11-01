// Stand-in for @react-navigation/native. Only the focus hooks the shared screens call exist: a web
// route is focused for as long as it is mounted, so a focus effect is a plain effect and
// `useIsFocused` is true. Anything else fails the build, so a module needing more gets an override.
import { useEffect, type EffectCallback } from "react";

export function useFocusEffect(effect: EffectCallback): void {
  useEffect(effect, [effect]);
}

export function useIsFocused(): boolean {
  return true;
}
