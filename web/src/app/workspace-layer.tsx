// packages/app pushes Settings, History, Schedules and the other app-wide screens over the
// workspace on its navigation stack, so the workspace stays mounted under them: a terminal keeps its
// emulator, a chat its scroll position and drafts, and Back shows the same screen again. React
// Router unmounts a route it leaves, so the workspace route renders here instead, in a layer the
// shell keeps mounted (hidden) while a pushed screen is on top. Opening a workspace from one of
// those screens, or going back to the project picker, replaces it, as the stack did.
import { useState, type ReactNode } from "react";
import { useLocation, useRoutes, type Location, type RouteObject } from "react-router";
import { RouteFocusProvider } from "@react-navigation/native";
import HostWorkspaceRoute from "@/app/h/[serverId]/workspace/[workspaceId]/index";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { HostLayout } from "~/app/routes";
import { GlobalLocationProvider } from "~/shims/expo-router";

/** The data router's entry for the route (it matches it; this layer renders it). */
export const WORKSPACE_ROUTE: RouteObject = {
  path: "workspace/:workspaceId",
  element: <HostWorkspaceRoute />,
};

const LAYER_ROUTES: RouteObject[] = [
  { path: "h/:serverId", element: <HostLayout />, children: [WORKSPACE_ROUTE] },
];

// Matches nothing, for when no workspace is retained.
const NO_WORKSPACE = "/__no-workspace";

export function isWorkspacePathname(pathname: string): boolean {
  return parseHostWorkspaceRouteFromPathname(pathname) !== null;
}

/** Screens that replace the workspace on packages/app's stack instead of covering it. */
function replacesWorkspace(pathname: string): boolean {
  return pathname === "/" || pathname === "/open-project" || pathname === "/welcome";
}

/**
 * The workspace route, for the location on screen or the one a pushed screen covers. `children`
 * renders the other routes; the layer and they never show at once.
 */
export function WorkspaceLayer({ children }: { children: ReactNode }) {
  const location = useLocation();
  const onWorkspace = isWorkspacePathname(location.pathname);
  const [covered, setCovered] = useState<Location | null>(null);
  if (onWorkspace && covered?.key !== location.key) setCovered(location);
  else if (!onWorkspace && covered && replacesWorkspace(location.pathname)) setCovered(null);
  const layer = useRoutes(LAYER_ROUTES, onWorkspace ? location : (covered ?? NO_WORKSPACE));
  return (
    <>
      {/* The same element whether shown or covered, so covering never remounts the workspace. */}
      <div className={onWorkspace ? "contents" : "hidden"} data-testid="workspace-layer">
        <GlobalLocationProvider value={location}>
          <RouteFocusProvider focused={onWorkspace}>{layer}</RouteFocusProvider>
        </GlobalLocationProvider>
      </div>
      {onWorkspace ? null : children}
    </>
  );
}
