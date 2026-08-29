import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHosts } from "@/runtime/host-runtime";
import SettingsScreen from "@/screens/settings-screen";
import {
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
  isSettingsSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";

// COMPAT(settingsDaemonRedirect): added 2026-07-08, remove after 2027-01-08.
function SettingsDaemonRedirect() {
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();

  if (localServerId !== null && hosts.some((host) => host.serverId === localServerId)) {
    return <Redirect href={buildSettingsHostSectionRoute(localServerId, "host")} />;
  }

  return <Redirect href={buildSettingsRoute()} />;
}

export default function SettingsSectionRoute() {
  const params = useLocalSearchParams<{ section?: string; addHost?: string }>();
  const rawSection = typeof params.section === "string" ? params.section : "";
  const section: SettingsSectionSlug = isSettingsSectionSlug(rawSection)
    ? rawSection
    : "preferences";
  const openAddHostIntent = typeof params.addHost === "string" ? params.addHost : null;
  const view = useMemo(() => ({ kind: "section" as const, section }), [section]);

  // COMPAT(settingsDaemonRedirect): added 2026-07-08, remove after 2027-01-08.
  if (rawSection === "daemon") {
    return (
      <HostRouteBootstrapBoundary>
        <SettingsDaemonRedirect />
      </HostRouteBootstrapBoundary>
    );
  }

  return <SettingsScreen view={view} openAddHostIntent={openAddHostIntent} />;
}
