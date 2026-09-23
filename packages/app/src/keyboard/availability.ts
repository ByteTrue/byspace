import { useIsCompactFormFactor } from "@/constants/layout";

export function keyboardShortcutsAvailable(isCompact: boolean): boolean {
  return !isCompact;
}

export function useKeyboardShortcutsAvailable(): boolean {
  return keyboardShortcutsAvailable(useIsCompactFormFactor());
}
