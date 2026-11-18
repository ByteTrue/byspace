import { HostRouteBootstrapBoundary } from "@/app/host-route-bootstrap-boundary";
import { SessionsScreen } from "@/screens/sessions-screen";

export default function SessionsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <SessionsScreen />
    </HostRouteBootstrapBoundary>
  );
}
