// Port of archive/expo-app:packages/app/src/screens/settings/host-page.tsx: a host's Host, Connections, Agents and Usage pages; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/host-page.py; edit it directly.
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  CircleAlert,
  Globe,
  Monitor,
  Pencil,
  Plus,
  RotateCw,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import type { TFunction } from "i18next";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { TerminalProfile } from "@bytetrue/protocol/messages";
import {
  getTerminalProfileIcon,
  DEFAULT_TERMINAL_PROFILES,
} from "@bytetrue/protocol/terminal-profiles";
import { AgentProfilesSection } from "@/agent-profiles";
import { AgentSkillsSection } from "@/agent-skills";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsTextArea } from "@/components/settings-textarea";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { DefaultShellSection } from "@/screens/settings/default-shell-section";
import {
  ProfileDraft,
  TerminalProfileEditModal,
} from "@/screens/settings/terminal-profile-edit-modal";
import { PairDeviceModal } from "@/settings/pair-device-modal";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useIsServingDaemon } from "@/hooks/use-is-local-daemon";
import { NetworkSection } from "@/screens/settings/network-section";
import { DaemonServiceSection } from "@/screens/settings/daemon-service-section";
import { MetadataGenerationPage } from "@/screens/settings/metadata-generation-page";
import { hostPublicKey } from "@/runtime/host-keys";
import type { HostSyncRecord } from "@bytetrue/protocol/messages";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { ProvidersSection, AddProviderSection } from "@/screens/settings/providers-section";
import { ProviderUsageSettingsSection } from "@/provider-usage/settings-section";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { HostAppearanceSection } from "@/screens/settings/host-appearance-section";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isVersionMismatch } from "@/utils/version-display";
import { resolveAppVersion } from "@/utils/app-version";
import { formatConnectionStatus, getConnectionStatusTone } from "@/utils/daemons";
import { formatLatency } from "@/utils/latency";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { getProviderIcon } from "@/components/provider-icons";
import {
  hasDaemonReconnectedAfter,
  type DaemonConnectionMarker,
} from "@/screens/settings/daemon-reconnect";
import { restartDaemonFromSettings } from "@/screens/settings/daemon-restart";
import { useThemeObject, withTheme } from "~/app/theme-object";
import { showAlert } from "~/lib/alert";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "~/components/ui/item";

const ThemedArrowUp = withTheme(ArrowUp);
const ThemedArrowDown = withTheme(ArrowDown);
const ThemedProfilePencil = withTheme(Pencil);
const ThemedTrash2 = withTheme(Trash2);
const ThemedProfileSquareTerminal = withTheme(SquareTerminal);
const ThemedPlus = withTheme(Plus);

interface DynamicProviderIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function DynamicProviderIcon({ iconKey, size, color = "" }: DynamicProviderIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedDynamicProviderIcon = withTheme(DynamicProviderIcon);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} themeProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />;
const editProfileIcon = <ThemedProfilePencil size={ICON_SIZE.sm} themeProps={mutedColorMapping} />;
const removeProfileIcon = <ThemedTrash2 size={ICON_SIZE.sm} themeProps={destructiveColorMapping} />;
const addProfileIcon = <ThemedPlus size={ICON_SIZE.sm} themeProps={mutedColorMapping} />;

function formatHostConnectionLabel(connection: HostConnection, t: TFunction): string {
  if (connection.type === "relay") {
    return `${t("settings.host.badges.relay")} (${connection.relayEndpoint})`;
  }
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return `${t("settings.host.badges.local")} (${connection.path})`;
  }
  if (connection.type === "remoteSsh") {
    return `${t("settings.host.badges.remoteSsh")} (${connection.host})`;
  }
  return `TCP (${connection.endpoint})`;
}

function formatActiveConnectionBadge(
  activeConnection: { type: HostConnection["type"]; display: string } | null,
  theme: Theme,
  t: TFunction,
): { icon: React.ReactNode; text: string } | null {
  if (!activeConnection) return null;
  if (activeConnection.type === "relay") {
    return {
      icon: <Globe size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: t("settings.host.badges.relay"),
    };
  }
  if (activeConnection.type === "directSocket" || activeConnection.type === "directPipe") {
    return {
      icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: t("settings.host.badges.local"),
    };
  }
  if (activeConnection.type === "remoteSsh") {
    return {
      icon: <Globe size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: t("settings.host.badges.remoteSsh"),
    };
  }
  return {
    icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    text: activeConnection.display,
  };
}

function formatDaemonVersionBadge(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function useHostProfile(serverId: string): HostProfile | null {
  const daemons = useHosts();
  return daemons.find((entry) => entry.serverId === serverId) ?? null;
}

function HostNotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <ItemGroup className="items-center p-4">
        <span className="text-sm leading-[normal] text-muted-foreground">
          {t("settings.host.notFound")}
        </span>
      </ItemGroup>
    </div>
  );
}

function HostStatusBadges({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? null,
  );

  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const activeConnection = snapshot?.activeConnection ?? null;
  const statusLabel = formatConnectionStatus(connectionStatus);
  const statusTone = getConnectionStatusTone(connectionStatus);
  let statusClassName: string | undefined;
  let statusDotColor = theme.colors.foregroundMuted;
  if (statusTone === "success") {
    statusClassName = "text-status-success";
    statusDotColor = theme.colors.statusDotSuccess;
  } else if (statusTone === "warning") {
    statusClassName = "text-status-warning";
    statusDotColor = theme.colors.statusDotWarning;
  } else if (statusTone === "error") {
    statusClassName = "text-status-danger";
    statusDotColor = theme.colors.statusDotDanger;
  }
  const connectionBadge = formatActiveConnectionBadge(activeConnection, theme, t);
  const versionBadgeText = formatDaemonVersionBadge(daemonVersion);
  const statusDotStyle = useMemo(() => ({ backgroundColor: statusDotColor }), [statusDotColor]);
  const statusLeading = useMemo(
    () => <span className="size-1.5 shrink-0 rounded-full" style={statusDotStyle} />,
    [statusDotStyle],
  );

  return (
    <div
      className="mb-6 flex flex-row flex-wrap items-center gap-1"
      data-testid="host-page-identity"
    >
      <Badge variant="secondary" className={statusClassName}>
        {statusLeading}
        {statusLabel}
      </Badge>
      {connectionBadge ? (
        <Badge variant="outline" className="max-w-[200px]">
          {connectionBadge.icon}
          <span className="truncate">{connectionBadge.text}</span>
        </Badge>
      ) : null}
      {versionBadgeText ? (
        <Badge variant="outline" className="max-w-[200px]">
          <span className="truncate">{versionBadgeText}</span>
        </Badge>
      ) : null}
    </div>
  );
}

function HostConnectionError({ serverId }: { serverId: string }) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const lastError = snapshot?.lastError ?? null;
  const connectionError =
    typeof lastError === "string" && lastError.trim().length > 0 ? lastError.trim() : null;
  if (!connectionError) return null;
  return (
    <span className="mb-2 block text-xs leading-[normal] text-red-300">{connectionError}</span>
  );
}

// HostPasswordPrompt asks for the password of a relay host that has none stored yet.
//
// Each host has its own password, and it lives only on this device. A relay host without one
// cannot get past the daemon, so the prompt is the way in. Saving writes it onto the connection,
// which reconnects with it.
function HostPasswordPrompt({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { upsertRelayConnection } = useHostMutations();
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const relay = host.connections.find((connection) => connection.type === "relay");
  const save = useCallback(() => {
    const trimmed = password.trim();
    if (!relay || relay.type !== "relay" || !trimmed || saving) return;
    setSaving(true);
    void upsertRelayConnection({
      serverId: host.serverId,
      relayEndpoint: relay.relayEndpoint,
      useTls: relay.useTls,
      daemonPublicKeyB64: relay.daemonPublicKeyB64,
      password: trimmed,
    })
      .catch(() => undefined)
      .finally(() => setSaving(false));
  }, [host.serverId, password, relay, saving, upsertRelayConnection]);
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value),
    [],
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") save();
    },
    [save],
  );
  if (!relay || relay.type !== "relay" || relay.password) {
    return null;
  }
  return (
    <div className="mb-3 flex flex-col gap-2">
      <span className="text-sm leading-[normal] text-muted-foreground">
        {t("tunnels.addForm.passwordRequired")}
      </span>
      <div className="flex flex-row gap-2">
        <Input
          type="password"
          value={password}
          aria-label={t("tunnels.addForm.passwordLabel")}
          placeholder={t("tunnels.addForm.passwordPlaceholder")}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <Button onClick={save} disabled={saving || password.trim().length === 0}>
          {t("connectionMethods.direct.actions.connect")}
        </Button>
      </div>
    </div>
  );
}

export function HostConnectionsPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <div className="flex flex-col">
      <HostConnectionError serverId={serverId} />
      <HostPasswordPrompt host={host} />
      <ConnectionsSection host={host} />
      <PairDeviceRow serverId={serverId} />
    </div>
  );
}

export function HostAgentsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <div className="flex flex-col">
      <ProvidersSection serverId={serverId} />
      {isConnected ? (
        <SettingsSection title={t("settings.hostSections.agents")}>
          <AppendSystemPromptCard serverId={serverId} />
        </SettingsSection>
      ) : (
        <ItemGroup className="items-center p-4">
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("settings.host.agents.unavailable")}
          </span>
        </ItemGroup>
      )}
      <AgentSkillsSection serverId={serverId} />
      <TerminalProfilesSection serverId={serverId} />
      <AgentProfilesSection serverId={serverId} />
      <MetadataGenerationPage serverId={serverId} />
      <AddProviderSection serverId={serverId} />
    </div>
  );
}

export function HostUsagePage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(serverId);
  const handleRefresh = useCallback(() => {
    void refreshProviderUsage();
  }, [refreshProviderUsage]);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <div className="flex flex-col">
      <ProviderUsageSettingsSection view={providerUsageView} onRefresh={handleRefresh} />
    </div>
  );
}

export function HostSettingsPage({
  serverId,
  onHostRemoved,
}: {
  serverId: string;
  onHostRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isServingDaemon = useIsServingDaemon(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex flex-row items-center gap-1">
        <span className="shrink truncate text-base leading-[normal] font-medium text-foreground">
          {host.label}
        </span>
      </div>

      <HostStatusBadges serverId={serverId} />

      <HostAppearanceSection host={host} />

      <DefaultShellSection serverId={serverId} />

      {isConnected ? (
        <SettingsSection
          title={t("settings.hostSections.workspaces")}
          testID="host-page-workspaces-section"
        >
          <AutoArchiveMergedWorkspacesCard serverId={serverId} />
        </SettingsSection>
      ) : null}

      <NetworkSection serverId={serverId} />

      <DevicesSection serverId={serverId} />

      <DaemonServiceSection serverId={serverId} />

      {!isServingDaemon ? <UpdateDaemonCard key={host.serverId} host={host} /> : null}

      <RemoveHostSection host={host} isServingDaemon={isServingDaemon} onRemoved={onHostRemoved} />
    </div>
  );
}

function DeviceRow({
  id,
  label,
  detail,
  action,
  remove,
  onChange,
}: {
  id: string;
  label: string;
  detail?: string;
  action: string;
  remove: boolean;
  onChange: (id: string, remove: boolean) => void;
}) {
  const onAction = useCallback(() => onChange(id, remove), [id, onChange, remove]);
  return (
    <Item>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
        {detail ? <ItemDescription>{detail}</ItemDescription> : null}
      </ItemContent>
      <Button variant="ghost" onClick={onAction}>
        {action}
      </Button>
    </Item>
  );
}

function memberKey(record: HostSyncRecord): string {
  const data = record.data as { publicKey?: unknown } | undefined;
  return typeof data?.publicKey === "string" ? data.publicKey : "";
}

// DevicesSection lists the daemons in the sync chain and adds or removes them.
//
// Adding is offered for a host this device already connects to, because that connection is the
// proof the user holds both passwords. Removing leaves a permanent tombstone, so the daemon cannot
// be synced back in by a replica that missed the removal.
function DevicesSection({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const hosts = useHosts();
  const [members, setMembers] = useState<HostSyncRecord[]>([]);
  const [supported, setSupported] = useState(true);

  const refresh = useCallback(() => {
    if (!client || client.getLastServerInfoMessage()?.features?.hostSync !== true) {
      setSupported(false);
      return;
    }
    void client
      .exchangeHostSync({})
      .then((result) => {
        setMembers((result.records ?? []).filter((record) => record.kind === "member"));
        return undefined;
      })
      .catch(() => setSupported(false));
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const memberIds = useMemo(
    () => new Set(members.filter((member) => !member.deleted).map((member) => member.id)),
    [members],
  );

  const change = useCallback(
    (id: string, remove: boolean) => {
      if (!client) return;
      const host = hosts.find((candidate) => candidate.serverId === id);
      const key = host ? hostPublicKey(host) : null;
      void client
        .exchangeHostSync({
          changes: [
            remove
              ? { kind: "member", id, delete: true }
              : { kind: "member", id, data: { publicKey: key ?? "" } },
          ],
        })
        .then(() => {
          refresh();
          return undefined;
        })
        .catch(() => undefined);
    },
    [client, hosts, refresh],
  );

  if (!supported) {
    return (
      <SettingsSection title="Devices">
        <span className="block px-4 py-2 text-sm text-muted-foreground">
          Update this host to sync devices across your machines.
        </span>
      </SettingsSection>
    );
  }

  const joinable = hosts.filter(
    (host) => host.serverId !== serverId && !memberIds.has(host.serverId) && hostPublicKey(host),
  );

  const active = members.filter((member) => !member.deleted);

  return (
    <SettingsSection title="Devices">
      {active.length === 0 ? (
        <span className="block px-4 py-2 text-sm text-muted-foreground">No other devices yet.</span>
      ) : (
        active.map((member) => (
          <DeviceRow
            key={member.id}
            id={member.id}
            label={hosts.find((host) => host.serverId === member.id)?.label ?? member.id}
            detail={memberKey(member)}
            action="Remove"
            remove
            onChange={change}
          />
        ))
      )}
      {joinable.map((host) => (
        <DeviceRow
          key={host.serverId}
          id={host.serverId}
          label={host.label}
          action="Add device"
          remove={false}
          onChange={change}
        />
      ))}
    </SettingsSection>
  );
}

function ConnectionsSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { removeConnection } = useHostMutations();
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const probeByConnectionId = snapshot?.probeByConnectionId ?? new Map();
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<{
    connectionId: string;
    title: string;
  } | null>(null);
  const [isRemovingConnection, setIsRemovingConnection] = useState(false);
  const removeConnectionHeader = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.connections.removeTitle") }),
    [t],
  );

  const handleRequestRemove = useCallback(
    (connection: HostConnection) => {
      setPendingRemoveConnection({
        connectionId: connection.id,
        title: formatHostConnectionLabel(connection, t),
      });
    },
    [t],
  );

  const handleCloseConfirm = useCallback(() => {
    if (isRemovingConnection) return;
    setPendingRemoveConnection(null);
  }, [isRemovingConnection]);

  const handleCancelConfirm = useCallback(() => {
    setPendingRemoveConnection(null);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!pendingRemoveConnection) return;
    const { connectionId } = pendingRemoveConnection;
    setIsRemovingConnection(true);
    void removeConnection(host.serverId, connectionId)
      .then(() => setPendingRemoveConnection(null))
      .catch((error) => {
        console.error("[HostPage] Failed to remove connection", error);
        showAlert(
          t("settings.host.connections.removeErrorTitle"),
          t("settings.host.connections.removeErrorMessage"),
        );
      })
      .finally(() => setIsRemovingConnection(false));
  }, [pendingRemoveConnection, removeConnection, host.serverId, t]);

  return (
    <SettingsSection title={t("settings.host.connections.title")}>
      <ItemGroup data-testid="host-page-connections-card">
        {host.connections.map((conn) => {
          const probe = probeByConnectionId.get(conn.id);
          return (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              latencyMs={probe?.status === "available" ? probe.latencyMs : undefined}
              latencyLoading={!probe || probe.status === "pending"}
              latencyError={probe?.status === "unavailable"}
              onRemove={handleRequestRemove}
            />
          );
        })}
      </ItemGroup>

      {pendingRemoveConnection ? (
        <AdaptiveModalSheet
          header={removeConnectionHeader}
          visible
          onClose={handleCloseConfirm}
          testID="remove-connection-confirm-modal"
        >
          <span className="block text-sm leading-[normal] text-muted-foreground">
            {t("settings.host.connections.removeMessage", {
              name: pendingRemoveConnection.title,
            })}
          </span>
          <div className="mt-4 flex flex-row items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCancelConfirm}
              disabled={isRemovingConnection}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmRemove}
              data-testid="remove-connection-confirm"
              disabled={isRemovingConnection}
            >
              {t("settings.host.connections.removeAction")}
            </Button>
          </div>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  latencyMs,
  latencyLoading,
  latencyError,
  onRemove,
}: {
  connection: HostConnection;
  latencyMs: number | null | undefined;
  latencyLoading: boolean;
  latencyError: boolean;
  onRemove: (connection: HostConnection) => void;
}) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const title = formatHostConnectionLabel(connection, t);

  const latencyText = (() => {
    if (latencyLoading) return "...";
    if (latencyError) return t("settings.host.connections.timeout");
    if (latencyMs != null) return formatLatency(latencyMs);
    return "—";
  })();
  const latencyColor = latencyError ? theme.colors.palette.red[300] : theme.colors.foregroundMuted;

  const handlePressRemove = useCallback(() => {
    onRemove(connection);
  }, [onRemove, connection]);

  const latencyTextStyle = useMemo(() => ({ color: latencyColor }), [latencyColor]);

  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle className="truncate">{title}</ItemTitle>
      </ItemContent>
      <span className="mr-2 text-sm leading-[normal]" style={latencyTextStyle}>
        {latencyText}
      </span>
      <Button variant="ghost" size="sm" className="text-destructive" onClick={handlePressRemove}>
        {t("settings.host.connections.removeAction")}
      </Button>
    </Item>
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function RestartDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [isRestarting, setIsRestarting] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (restartRequest: Promise<void>) => {
      const disconnectTimeoutMs = 30000;
      const reconnectTimeoutMs = 30000;
      const requestFailureDisconnectGraceMs = 2000;
      const disconnectedPromise = isHostConnected()
        ? waitForCondition(() => !isHostConnected(), disconnectTimeoutMs)
        : Promise.resolve(true);
      const restartResult = await restartRequest.then(
        () => ({ status: "accepted" as const }),
        async (error) => ({
          status: "rejected" as const,
          error,
          disconnectedAfterFailure: await waitForCondition(
            () => !isHostConnected(),
            requestFailureDisconnectGraceMs,
            100,
          ),
        }),
      );
      if (!isMountedRef.current) return;

      if (restartResult.status === "rejected" && !restartResult.disconnectedAfterFailure) {
        console.error(`[HostPage] Failed to restart daemon ${host.label}`, restartResult.error);
        setIsRestarting(false);
        showAlert(
          t("settings.host.daemon.restart.requestFailedTitle"),
          t("settings.host.daemon.restart.requestFailedMessage"),
        );
        return;
      }

      const disconnected =
        restartResult.status === "rejected"
          ? restartResult.disconnectedAfterFailure
          : await disconnectedPromise;
      const reconnected =
        disconnected && (await waitForCondition(() => isHostConnected(), reconnectTimeoutMs));
      if (isMountedRef.current) {
        setIsRestarting(false);
        if (!reconnected) {
          showAlert(
            t("settings.host.daemon.restart.unableToReconnectTitle"),
            t("settings.host.daemon.restart.unableToReconnectMessage", { name: host.label }),
          );
        }
      }
    },
    [host.label, isHostConnected, t, waitForCondition],
  );

  const handleRestart = useCallback(() => {
    if (!daemonClient) {
      showAlert(
        t("settings.host.daemon.restart.unavailableTitle"),
        t("settings.host.daemon.restart.unavailableMessage"),
      );
      return;
    }
    if (!isHostConnected()) {
      showAlert(
        t("settings.host.daemon.restart.offlineTitle"),
        t("settings.host.daemon.restart.offlineMessage"),
      );
      return;
    }

    void confirmDialog({
      title: t("settings.host.daemon.restart.confirmTitle", { name: host.label }),
      message: t("settings.host.daemon.restart.confirmMessage"),
      confirmLabel: t("settings.host.daemon.restart.confirm"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    })
      .then((confirmed) => {
        if (!confirmed) return;
        setIsRestarting(true);
        const restartRequest = restartDaemonFromSettings(
          host.serverId,
          `settings_daemon_restart_${host.serverId}`,
          {
            restartServer: (reason) => daemonClient.restartServer(reason),
          },
        );
        void waitForDaemonRestart(restartRequest);
        return;
      })
      .catch((error) => {
        console.error(`[HostPage] Failed to open restart confirmation for ${host.label}`, error);
        showAlert(
          t("settings.host.daemon.restart.requestFailedTitle"),
          t("settings.host.daemon.restart.dialogFailedMessage"),
        );
      });
  }, [daemonClient, host.label, host.serverId, isHostConnected, t, waitForDaemonRestart]);

  const restartIcon = useMemo(
    () => <RotateCw size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  return (
    <ItemGroup data-testid="host-page-restart-card">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{t("settings.host.daemon.restart.title")}</ItemTitle>
          <ItemDescription>{t("settings.host.daemon.restart.hint")}</ItemDescription>
        </ItemContent>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRestart}
          data-testid="host-page-restart-button"
          disabled={isRestarting || !daemonClient || !isConnected}
        >
          {restartIcon}
          {isRestarting
            ? t("settings.host.daemon.restart.restarting")
            : t("settings.host.daemon.restart.confirm")}
        </Button>
      </Item>
    </ItemGroup>
  );
}

type DaemonUpdateState =
  | { status: "idle" }
  | { status: "updating"; phase: string }
  | { status: "failed"; title: string; message: string };

function UpdateDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [updateState, setUpdateState] = useState<DaemonUpdateState>({ status: "idle" });
  const isMountedRef = useRef(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );
  const supportsSelfUpdate = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonSelfUpdate === true,
  );
  const desktopManaged = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.desktopManaged === true,
  );

  const appVersion = resolveAppVersion();
  const hasVersionMismatch = isVersionMismatch(appVersion, daemonVersion);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      unsubscribeRef.current?.();
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );
  const hasReconnectedAfter = useCallback(
    (startMarker: DaemonConnectionMarker | null) =>
      hasDaemonReconnectedAfter(runtime.getSnapshot(host.serverId), startMarker),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (startMarker: DaemonConnectionMarker | null) => {
      const disconnectTimeoutMs = 15000;
      const reconnectTimeoutMs = 120000; // 2 minutes — npm update + restart can take a while
      if (!hasReconnectedAfter(startMarker) && isHostConnected()) {
        await waitForCondition(
          () => !isHostConnected() || hasReconnectedAfter(startMarker),
          disconnectTimeoutMs,
        );
      }
      const reconnected =
        hasReconnectedAfter(startMarker) ||
        (await waitForCondition(() => hasReconnectedAfter(startMarker), reconnectTimeoutMs));
      if (isMountedRef.current) {
        if (!reconnected) {
          setUpdateState({
            status: "failed",
            title: t("settings.host.daemon.update.unableToReconnectTitle"),
            message: t("settings.host.daemon.update.unableToReconnectMessage", {
              name: host.label,
            }),
          });
          return;
        }
        setUpdateState({ status: "idle" });
      }
    },
    [hasReconnectedAfter, host.label, isHostConnected, t, waitForCondition],
  );

  const handleUpdate = useCallback(() => {
    if (!daemonClient) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.unavailableTitle"),
        message: t("settings.host.daemon.update.unavailableMessage"),
      });
      return;
    }
    if (!isHostConnected()) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.offlineTitle"),
        message: t("settings.host.daemon.update.offlineMessage"),
      });
      return;
    }

    void confirmDialog({
      title: t("settings.host.daemon.update.confirmTitle", { name: host.label }),
      message: t("settings.host.daemon.update.confirmMessage"),
      confirmLabel: t("settings.host.daemon.update.confirm"),
      cancelLabel: t("common.actions.cancel"),
      destructive: false,
    })
      .then((confirmed) => {
        if (!confirmed || !isMountedRef.current) return;
        const startSnapshot = runtime.getSnapshot(host.serverId);
        const startMarker = startSnapshot
          ? {
              clientGeneration: startSnapshot.clientGeneration,
              lastOnlineAt: startSnapshot.lastOnlineAt,
            }
          : null;
        setUpdateState({
          status: "updating",
          phase: t("settings.host.daemon.update.phaseStarting"),
        });
        const requestId = `settings_daemon_update_${host.serverId}`;

        const unsubscribe = daemonClient.on("daemon.update.progress", (message) => {
          if (message.payload.requestId !== requestId) return;
          if (!isMountedRef.current) return;
          const { phase } = message.payload;
          if (phase === "starting")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseStarting"),
            });
          else if (phase === "downloading")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseDownloading"),
            });
          else if (phase === "installing")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseInstalling"),
            });
          else if (phase === "complete")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseComplete"),
            });
        });
        unsubscribeRef.current = unsubscribe;

        void daemonClient
          .updateDaemon(requestId)
          .then((response) => {
            unsubscribeRef.current = null;
            unsubscribe();
            if (!response.success) {
              if (!isMountedRef.current) return undefined;
              setUpdateState({
                status: "failed",
                title: t("settings.host.daemon.update.requestFailedTitle"),
                message: t("settings.host.daemon.update.requestFailedMessage", {
                  error: response.error ?? "Unknown error",
                }),
              });
              return undefined;
            }
            // Update succeeded — wait for daemon to restart and reconnect
            void waitForDaemonRestart(startMarker);
            return undefined;
          })
          .catch((error) => {
            unsubscribeRef.current = null;
            unsubscribe();
            console.error(`[HostPage] Failed to update daemon ${host.label}`, error);
            if (!isMountedRef.current) return;
            setUpdateState({
              status: "failed",
              title: t("settings.host.daemon.update.requestFailedTitle"),
              message: t("settings.host.daemon.update.requestFailedMessage", {
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            });
          });
        return;
      })
      .catch((error) => {
        console.error(`[HostPage] Failed to open update confirmation for ${host.label}`, error);
        if (!isMountedRef.current) return;
        setUpdateState({
          status: "failed",
          title: t("settings.host.daemon.update.requestFailedTitle"),
          message: t("settings.host.daemon.update.dialogFailedMessage"),
        });
      });
  }, [daemonClient, host.label, host.serverId, isHostConnected, runtime, t, waitForDaemonRestart]);

  const updateIcon = useMemo(
    () => <ArrowUpToLine size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  const shouldShowUpdate = hasVersionMismatch && (supportsSelfUpdate || desktopManaged);
  if (!shouldShowUpdate) {
    return null;
  }

  const isUpdating = updateState.status === "updating";
  const buttonLabel = isUpdating ? updateState.phase : t("settings.host.daemon.update.confirm");

  return (
    <ItemGroup data-testid="host-page-update-card">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{t("settings.host.daemon.update.title")}</ItemTitle>
          <ItemDescription>
            {desktopManaged
              ? t("settings.host.daemon.update.desktopManagedHint")
              : t("settings.host.daemon.update.hint")}
          </ItemDescription>
        </ItemContent>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpdate}
          data-testid="host-page-update-button"
          disabled={desktopManaged || isUpdating || !daemonClient || !isConnected}
        >
          {updateIcon}
          {buttonLabel}
        </Button>
      </Item>
      {updateState.status === "failed" ? (
        <div className="mx-4 mb-4">
          <Alert variant="destructive" data-testid="host-page-update-error">
            <CircleAlert />
            <AlertTitle>{updateState.title}</AlertTitle>
            <AlertDescription>{updateState.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </ItemGroup>
  );
}

function AutoArchiveMergedWorkspacesCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ autoArchiveAfterMerge: next }).catch((error) => {
        console.error("[HostPage] Failed to update auto-archive after merge", error);
        showAlert(
          "Unable to update workspaces",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <ItemGroup data-testid="host-page-auto-archive-merged-workspaces-card">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Archive merged PR workspaces</ItemTitle>
          <ItemDescription>
            Automatically archive clean BySpace workspaces after their pull request is merged
          </ItemDescription>
        </ItemContent>
        <Switch
          checked={config?.autoArchiveAfterMerge === true}
          onCheckedChange={handleValueChange}
          aria-label="Archive merged PR workspaces"
          data-testid="host-page-auto-archive-merged-workspaces-switch"
        />
      </Item>
    </ItemGroup>
  );
}

function AppendSystemPromptCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persistedPrompt = config?.appendSystemPrompt ?? "";
  const [draft, setDraft] = useState(persistedPrompt);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.orchestration.systemPrompt.sheetTitle") }),
    [t],
  );

  useEffect(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  const hasChanges = draft !== persistedPrompt;

  const handleOpen = useCallback(() => {
    setDraft(persistedPrompt);
    setIsEditing(true);
  }, [persistedPrompt]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setDraft(persistedPrompt);
    setIsEditing(false);
  }, [isSaving, persistedPrompt]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    void patchConfig({ appendSystemPrompt: draft })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to save append system prompt", error);
      })
      .finally(() => setIsSaving(false));
  }, [draft, patchConfig]);

  const handleReset = useCallback(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  if (!isConnected) return null;

  return (
    <>
      <ItemGroup data-testid="host-page-append-system-prompt-card">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.host.orchestration.systemPrompt.title")}</ItemTitle>
            <ItemDescription>{t("settings.host.orchestration.systemPrompt.hint")}</ItemDescription>
          </ItemContent>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpen}
            data-testid="host-page-append-system-prompt-edit"
          >
            {t("settings.host.orchestration.systemPrompt.edit")}
          </Button>
        </Item>
      </ItemGroup>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          testID="host-page-append-system-prompt-sheet"
          desktopMaxWidth={560}
        >
          <SettingsTextArea
            testID="host-page-append-system-prompt-input"
            accessibilityLabel={t("settings.host.orchestration.systemPrompt.accessibilityLabel")}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("settings.host.orchestration.systemPrompt.placeholder")}
          />
          <div className="flex flex-row justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              data-testid="host-page-append-system-prompt-reset"
              disabled={!hasChanges || isSaving}
            >
              {t("settings.host.orchestration.systemPrompt.reset")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              data-testid="host-page-append-system-prompt-save"
              disabled={!hasChanges || isSaving}
            >
              {isSaving
                ? t("settings.host.orchestration.systemPrompt.saving")
                : t("settings.host.orchestration.systemPrompt.save")}
            </Button>
          </div>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

function PairDeviceRow({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => setIsModalOpen(true), []);
  const handleClose = useCallback(() => setIsModalOpen(false), []);

  return (
    <ItemGroup>
      <Item asChild variant="outline" className="w-full text-left">
        <button type="button" onClick={handleOpen} data-testid="host-page-pair-device-row">
          <ItemContent>
            <ItemTitle>{t("settings.host.pairDevices.rowTitle")}</ItemTitle>
            <ItemDescription>{t("settings.host.pairDevices.rowHint")}</ItemDescription>
          </ItemContent>
          <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
        </button>
      </Item>

      <PairDeviceModal
        serverId={serverId}
        visible={isModalOpen}
        onClose={handleClose}
        testID="host-page-pair-device-card"
      />
    </ItemGroup>
  );
}

function RemoveHostSection({
  host,
  isServingDaemon,
  onRemoved,
}: {
  host: HostProfile;
  isServingDaemon: boolean;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const { removeHost } = useHostMutations();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const removeHostHeader = useMemo<SheetHeader>(
    () => ({
      title: isServingDaemon
        ? t("settings.host.daemon.remove.localConfirmTitle")
        : t("settings.host.daemon.remove.title"),
    }),
    [isServingDaemon, t],
  );

  const handleOpenConfirm = useCallback(() => setIsConfirming(true), []);
  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setIsConfirming(false);
  }, [isRemoving]);
  const handleCancel = useCallback(() => setIsConfirming(false), []);
  const handleConfirmRemove = useCallback(() => {
    setIsRemoving(true);
    const remove = async () => {
      // Desktop-managed daemon stop-on-remove is retired (issue 025 A3);
      // removing the host entry never touches a daemon process.
      await removeHost(host.serverId);
    };
    void remove()
      .then(() => {
        setIsConfirming(false);
        onRemoved?.();
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to remove host", error);
        showAlert(
          t("settings.host.daemon.remove.errorTitle"),
          isServingDaemon
            ? t("settings.host.daemon.remove.localErrorMessage")
            : t("settings.host.daemon.remove.errorMessage"),
        );
      })
      .finally(() => setIsRemoving(false));
  }, [host.serverId, isServingDaemon, onRemoved, removeHost, t]);

  const removeIcon = useMemo(
    () => <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />,
    [theme.iconSize.sm, theme.colors.destructive],
  );

  return (
    <SettingsSection
      title={t("settings.host.daemon.dangerZone")}
      testID="host-page-remove-host-card"
    >
      <RestartDaemonCard host={host} />

      <ItemGroup>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>
              {isServingDaemon
                ? t("settings.host.daemon.remove.localTitle")
                : t("settings.host.daemon.remove.title")}
            </ItemTitle>
            <ItemDescription>
              {isServingDaemon
                ? t("settings.host.daemon.remove.localHint")
                : t("settings.host.daemon.remove.hint")}
            </ItemDescription>
          </ItemContent>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={handleOpenConfirm}
            data-testid="host-page-remove-host-button"
          >
            {removeIcon}
            {t("settings.host.connections.removeAction")}
          </Button>
        </Item>
      </ItemGroup>

      {isConfirming ? (
        <AdaptiveModalSheet
          header={removeHostHeader}
          visible
          onClose={handleCloseConfirm}
          testID="remove-host-confirm-modal"
        >
          <span className="block text-sm leading-[normal] text-muted-foreground">
            {isServingDaemon
              ? t("settings.host.daemon.remove.localConfirmMessage")
              : t("settings.host.daemon.remove.confirmMessage", { name: host.label })}
          </span>
          <div className="mt-4 flex flex-row items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={handleCancel} disabled={isRemoving}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmRemove}
              data-testid="remove-host-confirm"
              disabled={isRemoving}
            >
              {t("settings.host.connections.removeAction")}
            </Button>
          </div>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Terminal Profiles
// ---------------------------------------------------------------------------

function generateProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function parseArgsString(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: "", command: "", args: "" };

interface TerminalProfileRowProps {
  profile: TerminalProfile;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function TerminalProfileRow({
  profile,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TerminalProfileRowProps) {
  const { t } = useTranslation();

  const handleEdit = useCallback(() => onEdit(profile.id), [onEdit, profile.id]);
  const handleRemove = useCallback(() => onRemove(profile.id), [onRemove, profile.id]);
  const handleMoveUp = useCallback(() => onMoveUp(profile.id), [onMoveUp, profile.id]);
  const handleMoveDown = useCallback(() => onMoveDown(profile.id), [onMoveDown, profile.id]);

  const commandText =
    profile.args && profile.args.length > 0
      ? `${profile.command} ${profile.args.join(" ")}`
      : profile.command;

  const icon = getTerminalProfileIcon(profile);

  return (
    <Item
      variant="outline"
      className="min-h-14 gap-2"
      data-testid={`terminal-profile-row-${profile.id}`}
    >
      <div className="flex w-4 items-center justify-center">
        {icon ? (
          <ThemedDynamicProviderIcon
            iconKey={icon}
            size={ICON_SIZE.md}
            themeProps={mutedColorMapping}
          />
        ) : (
          <ThemedProfileSquareTerminal size={ICON_SIZE.md} themeProps={mutedColorMapping} />
        )}
      </div>
      <ItemContent>
        <ItemTitle className="truncate">{profile.name}</ItemTitle>
        <ItemDescription className="truncate">{commandText}</ItemDescription>
      </ItemContent>
      <div className="flex flex-row items-center gap-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMoveUp}
          aria-label={t("settings.host.terminalProfiles.moveUp")}
          data-testid={`terminal-profile-move-up-${profile.id}`}
          disabled={isFirst}
        >
          {moveUpIcon}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMoveDown}
          aria-label={t("settings.host.terminalProfiles.moveDown")}
          data-testid={`terminal-profile-move-down-${profile.id}`}
          disabled={isLast}
        >
          {moveDownIcon}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleEdit}
          aria-label={t("settings.host.terminalProfiles.editProfile")}
          data-testid={`terminal-profile-edit-${profile.id}`}
        >
          {editProfileIcon}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRemove}
          aria-label={t("settings.host.terminalProfiles.remove")}
          data-testid={`terminal-profile-remove-${profile.id}`}
        >
          {removeProfileIcon}
        </Button>
      </div>
    </Item>
  );
}

function TerminalProfilesSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [editingProfile, setEditingProfile] = useState<{
    id: string;
    draft: ProfileDraft;
  } | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Settings edits what is persisted, not the adopted view. Any save here
  // writes the whole list back, so resolving first would bake read-time prompt
  // adoption into the user's config the first time they reorder a row.
  const profiles = useMemo(
    () => (config ? (config.terminalProfiles ?? DEFAULT_TERMINAL_PROFILES) : null),
    [config],
  );

  const saveProfiles = useCallback(
    async (next: TerminalProfile[]) => {
      await patchConfig({ terminalProfiles: next });
    },
    [patchConfig],
  );

  const handleAddOpen = useCallback(() => setIsAdding(true), []);
  const handleAddClose = useCallback(() => setIsAdding(false), []);

  const handleAddSave = useCallback(
    async (draft: ProfileDraft) => {
      const current = profiles ? [...profiles] : [];
      const next: TerminalProfile[] = [
        ...current,
        {
          id: generateProfileId(),
          name: draft.name,
          command: draft.command,
          args: parseArgsString(draft.args),
        },
      ];
      await saveProfiles(next);
      setIsAdding(false);
    },
    [profiles, saveProfiles],
  );

  const handleEditOpen = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      setEditingProfile({
        id,
        draft: {
          name: profile.name,
          command: profile.command,
          args: profile.args ? profile.args.join(" ") : "",
        },
      });
    },
    [profiles],
  );

  const handleEditClose = useCallback(() => setEditingProfile(null), []);

  const handleEditSave = useCallback(
    async (draft: ProfileDraft) => {
      if (!editingProfile || !profiles) return;
      const next: TerminalProfile[] = profiles.map((p) =>
        p.id === editingProfile.id
          ? {
              ...p,
              name: draft.name,
              command: draft.command,
              args: parseArgsString(draft.args),
            }
          : p,
      );
      await saveProfiles(next);
      setEditingProfile(null);
    },
    [editingProfile, profiles, saveProfiles],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      void confirmDialog({
        title: t("settings.host.terminalProfiles.removeConfirmTitle"),
        message: t("settings.host.terminalProfiles.removeConfirmMessage", {
          name: profile.name,
        }),
        confirmLabel: t("settings.host.terminalProfiles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then(async (confirmed) => {
        if (!confirmed || !profiles) return;
        try {
          await saveProfiles(profiles.filter((p) => p.id !== id));
        } catch (error) {
          showAlert(
            t("common.errors.unableToSave"),
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      });
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveUp = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index <= 0) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index - 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        showAlert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveDown = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index < 0 || index >= profiles.length - 1) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index + 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        showAlert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleAddOpen}
        data-testid="terminal-profiles-add-button"
        disabled={!isConnected || !profiles}
      >
        {addProfileIcon}
      </Button>
    ),
    [handleAddOpen, isConnected, profiles],
  );

  if (!isConnected) {
    return (
      <ItemGroup data-testid="terminal-profiles-unavailable">
        <div className="flex flex-col items-center p-4">
          <span className="text-sm leading-[normal] text-muted-foreground text-center">
            {t("settings.host.terminalProfiles.unavailable")}
          </span>
        </div>
      </ItemGroup>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.host.terminalProfiles.sectionTitle")}
        trailing={addButton}
        testID="terminal-profiles-section"
      >
        <ItemGroup data-testid="terminal-profiles-card">
          {profiles && profiles.length > 0 ? (
            profiles.map((profile, index) => (
              <TerminalProfileRow
                key={profile.id}
                profile={profile}
                isFirst={index === 0}
                isLast={index === profiles.length - 1}
                onEdit={handleEditOpen}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))
          ) : (
            <div className="flex flex-col items-center p-4">
              <span className="text-sm leading-[normal] text-muted-foreground text-center">
                {t("settings.host.terminalProfiles.emptyState")}
              </span>
            </div>
          )}
        </ItemGroup>
      </SettingsSection>

      <TerminalProfileEditModal
        visible={isAdding}
        title={t("settings.host.terminalProfiles.addProfileTitle")}
        initialDraft={EMPTY_PROFILE_DRAFT}
        onClose={handleAddClose}
        onSave={handleAddSave}
        testID="terminal-profile-edit-modal"
      />

      {editingProfile ? (
        <TerminalProfileEditModal
          visible
          title={t("settings.host.terminalProfiles.editProfileTitle")}
          initialDraft={editingProfile.draft}
          onClose={handleEditClose}
          onSave={handleEditSave}
        />
      ) : null}
    </>
  );
}
