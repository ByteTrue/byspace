import { Navigate, Outlet, useParams } from "react-router";
import { useIsFocused } from "~/app/route-focus";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HostRouteProvider } from "@/navigation/host-route-context";
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { hrefToPath } from "~/app/navigation";
import SettingsScreen from "@/screens/settings-screen";

/** archive/expo-app:packages/app/src/app/h/[serverId]/_layout.tsx: an unknown host redirects, a known one scopes its leaves. */
export function HostLayout() {
  const { serverId } = useParams();
  // A workspace covered by a pushed screen must not navigate the screen on top away.
  const focused = useIsFocused();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const routeServerId = serverId ?? null;
  const startupRoute = resolveStartupRoute({
    route: { kind: "host", serverId: routeServerId },
    hostRegistryStatus,
    hosts,
  });
  if (startupRoute.kind === "redirect")
    return focused ? <Navigate to={hrefToPath(startupRoute.href)} replace /> : null;
  if (!routeServerId) return <Outlet />;
  return (
    <HostRouteProvider serverId={routeServerId}>
      <Outlet />
    </HostRouteProvider>
  );
}

/** archive/expo-app:packages/app/src/app/settings/index.tsx: desktop opens General, compact shows the section list. */
const SETTINGS_ROOT_VIEW = { kind: "root" as const };

export function SettingsIndexRoute() {
  const isCompact = useIsCompactFormFactor();
  if (!isCompact) return <Navigate to={hrefToPath(buildSettingsSectionRoute("general"))} replace />;
  return <SettingsScreen view={SETTINGS_ROOT_VIEW} />;
}
