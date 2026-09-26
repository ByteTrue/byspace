import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { CollabScreen } from "@/screens/collab-screen";

export default function CollabRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <CollabScreen />
    </HostRouteBootstrapBoundary>
  );
}
