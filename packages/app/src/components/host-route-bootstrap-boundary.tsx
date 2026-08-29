import type { ReactNode } from "react";
import { useHostRegistryStatus } from "@/runtime/host-runtime";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";

export function HostRouteBootstrapBoundary({ children }: { children: ReactNode }) {
  const hostRegistryStatus = useHostRegistryStatus();

  if (hostRegistryStatus === "loading") {
    return <StartupSplashScreen />;
  }

  return children;
}
