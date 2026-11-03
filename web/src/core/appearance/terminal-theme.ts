import type { TerminalAppearance } from "@/hooks/use-settings";
import { darkTheme, lightTheme, type Theme } from "@/styles/theme";

/**
 * Resolves the scheme the terminal pane renders with. "match" follows the app
 * theme; a forced scheme only substitutes when the active theme sits on the
 * other side, so a dark variant app theme (midnight, zinc, …) keeps its own
 * terminal palette even with "dark" selected.
 */
export function resolveTerminalTheme(active: Theme, preference: TerminalAppearance): Theme {
  if (preference === "dark") {
    return active.colorScheme === "dark" ? active : darkTheme;
  }
  if (preference === "light") {
    return active.colorScheme === "light" ? active : lightTheme;
  }
  return active;
}
