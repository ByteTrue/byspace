import { Redirect } from "@/platform/navigation";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { HostRouteBootstrapBoundary } from "@/app/host-route-bootstrap-boundary";
import { buildSettingsHostRoute, buildSettingsRoute } from "@/utils/host-routes";

/** Legacy host-scoped settings URL; the section lives under /settings/hosts/<id> now. */
export default function LegacyHostSettingsRoute() {
  const serverId = useHostRouteServerId();
  const href = serverId ? buildSettingsHostRoute(serverId) : buildSettingsRoute();

  return (
    <HostRouteBootstrapBoundary>
      <Redirect href={href} />
    </HostRouteBootstrapBoundary>
  );
}
