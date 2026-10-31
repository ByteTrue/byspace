import { useSyncExternalStore } from "react";
import { useAppSettings } from "@/hooks/use-settings";

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function subscribeSystemScheme(onChange: () => void) {
  const query = darkQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const readSystemDark = () => darkQuery().matches;

/** The scheme the app is drawn in: the theme setting, with "auto" following the OS. */
export function useResolvedColorScheme(): "light" | "dark" {
  const { settings, isLoading } = useAppSettings();
  const systemDark = useSyncExternalStore(subscribeSystemScheme, readSystemDark, readSystemDark);
  const theme = isLoading ? "auto" : settings.theme;
  if (theme === "auto") return systemDark ? "dark" : "light";
  return theme === "light" ? "light" : "dark";
}
