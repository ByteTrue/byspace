// Port of packages/app/src/navigation/workspace-route-navigation.ts. packages/app pops its stack
// back to the host screen and hands it the new workspace (POP_TO), or replaces the current screen when
// nothing sits above the host (dismissTo). In browser history that means a workspace never adds an
// entry: it replaces the host entry (a workspace, /open-project or /), after popping the screens pushed
// above it (Settings, History, Schedules...). So Back from a workspace leaves the app, as Android's
// back button does in packages/app, instead of walking through every workspace visited.
import { router } from "expo-router";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";

// React Router keeps its history index in history.state; this records, per index, whether the entry is
// host-level, as the router reports each location.
const hostLevelByIndex = new Map<number, boolean>();

function historyIndex(): number | null {
  const state: unknown = window.history.state;
  const index = typeof state === "object" && state !== null ? Reflect.get(state, "idx") : null;
  return typeof index === "number" ? index : null;
}

function isHostLevel(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/open-project" ||
    parseHostWorkspaceRouteFromPathname(pathname) !== null
  );
}

/** Called with every location the router commits (main.tsx). */
export function noteHistoryEntry(pathname: string): void {
  const index = historyIndex();
  if (index !== null) hostLevelByIndex.set(index, isHostLevel(pathname));
}

/** How many entries sit above the nearest host entry; 0 when it is unknown (a reload in between). */
function entriesAboveHost(): number {
  const index = historyIndex();
  if (index === null) return 0;
  for (let at = index; at >= 0; at -= 1) {
    const hostLevel = hostLevelByIndex.get(at);
    if (hostLevel === undefined) return 0;
    if (hostLevel) return index - at;
  }
  return 0;
}

export function registerWorkspaceRouteNavigationRef(): () => void {
  return () => {};
}

export function navigateToHostWorkspaceRoute(route: string): void {
  const depth = entriesAboveHost();
  if (depth === 0) {
    router.replace(route);
    return;
  }
  // Replace once the router has settled on the host entry.
  window.addEventListener("popstate", () => setTimeout(() => router.replace(route), 0), {
    once: true,
  });
  window.history.go(-depth);
}
