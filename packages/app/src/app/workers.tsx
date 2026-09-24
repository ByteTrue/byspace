import { useCallback } from "react";
import { router } from "expo-router";

import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { WorkersConsole } from "@/workers/workers-console";

/**
 * The workers console route.
 *
 * It renders its own shell, so the app's workspace sidebar stays off here — see
 * the `shouldShowAppChrome` check in `_layout.tsx`. Leaving it on would put the
 * workspace navigation beside the console's own sidebar.
 */
export default function WorkersRoute() {
  const handleExit = useCallback(() => {
    router.replace("/");
  }, []);

  return (
    <HostRouteBootstrapBoundary>
      <WorkersConsole onExit={handleExit} />
    </HostRouteBootstrapBoundary>
  );
}
