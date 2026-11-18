import { HostRouteBootstrapBoundary } from "@/app/host-route-bootstrap-boundary";
import { TunnelsScreen } from "@/screens/tunnels-screen";

export default function TunnelsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <TunnelsScreen />
    </HostRouteBootstrapBoundary>
  );
}
