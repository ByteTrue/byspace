import { HostRouteBootstrapBoundary } from "@/app/host-route-bootstrap-boundary";
import { SchedulesScreen } from "@/screens/schedules-screen";

export default function SchedulesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <SchedulesScreen />
    </HostRouteBootstrapBoundary>
  );
}
