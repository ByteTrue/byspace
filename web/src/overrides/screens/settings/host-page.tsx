// shortcut: placeholders for packages/app/src/screens/settings/host-page.tsx until step 4's host
// settings batch ports it.
import { PendingSettingsPage } from "~/settings/pending-settings";

export function HostConnectionsPage(_props: { serverId: string }) {
  return <PendingSettingsPage title="Connections" />;
}

export function HostAgentsPage(_props: { serverId: string }) {
  return <PendingSettingsPage title="Agents" />;
}

export function HostUsagePage(_props: { serverId: string }) {
  return <PendingSettingsPage title="Usage" />;
}

export function HostSettingsPage(_props: { serverId: string; onHostRemoved: () => void }) {
  return <PendingSettingsPage title="Host" />;
}
