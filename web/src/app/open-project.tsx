import { HostRouteBootstrapBoundary } from "@/app/host-route-bootstrap-boundary";
import { OpenProjectScreen } from "@/screens/open-project-screen";

export default function OpenProjectRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <OpenProjectScreen />
    </HostRouteBootstrapBoundary>
  );
}
