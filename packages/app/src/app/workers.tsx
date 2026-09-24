import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { WorkersScreen } from "@/screens/workers-screen";

export default function WorkersRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <WorkersScreen />
    </HostRouteBootstrapBoundary>
  );
}
