import { Navigate, Outlet, useParams } from "react-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HostRouteProvider } from "@/navigation/host-route-context";
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { hrefToPath } from "~/shims/expo-router";
import { PlaceholderPage } from "~/app/placeholder-page";
import SettingsScreen from "@/screens/settings-screen";

/** packages/app/src/app/h/[serverId]/_layout.tsx: an unknown host redirects, a known one scopes its leaves. */
export function HostLayout() {
  const { serverId } = useParams();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const routeServerId = serverId ?? null;
  const startupRoute = resolveStartupRoute({
    route: { kind: "host", serverId: routeServerId },
    hostRegistryStatus,
    hosts,
  });
  if (startupRoute.kind === "redirect")
    return <Navigate to={hrefToPath(startupRoute.href)} replace />;
  if (!routeServerId) return <Outlet />;
  return (
    <HostRouteProvider serverId={routeServerId}>
      <Outlet />
    </HostRouteProvider>
  );
}

/** packages/app/src/app/settings/index.tsx: desktop opens General, compact shows the section list. */
const SETTINGS_ROOT_VIEW = { kind: "root" as const };

export function SettingsIndexRoute() {
  const isCompact = useIsCompactFormFactor();
  if (!isCompact) return <Navigate to={hrefToPath(buildSettingsSectionRoute("general"))} replace />;
  return <SettingsScreen view={SETTINGS_ROOT_VIEW} />;
}

/** A page that has not moved yet, behind the same host-registry wait as its Expo route. */
export function PendingPage({ title, step }: { title: string; step: 3 | 4 }) {
  return (
    <HostRouteBootstrapBoundary>
      <PlaceholderPage title={title} step={step} />
    </HostRouteBootstrapBoundary>
  );
}
