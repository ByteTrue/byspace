import { useKeyboardShortcutsStore } from "@/keyboard/shortcuts-store";

export function useShowShortcutBadges(): boolean {
  return useKeyboardShortcutsStore((state) => state.showShortcutBadges);
}
