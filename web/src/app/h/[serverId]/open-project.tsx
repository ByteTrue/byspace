import { Redirect } from "@/platform/navigation";
import { HostRouteBootstrapBoundary } from "@/app/host-route-bootstrap-boundary";
import { buildOpenProjectRoute } from "@/utils/host-routes";

export default function HostOpenProjectRoute() {
  // COMPAT(hostOpenProjectRoute): added 2026-06-11, remove after 2026-12-11.
  return (
    <HostRouteBootstrapBoundary>
      <Redirect href={buildOpenProjectRoute()} />
    </HostRouteBootstrapBoundary>
  );
}
