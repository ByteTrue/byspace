// Port of archive/expo-app:packages/app/src/screens/tunnels-screen.tsx: the Tunnels page and its add / edit sheets; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/tunnels-screen.py; edit it directly.
import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useIsFocused } from "@/platform/route-focus";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowRightLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { MenuHeader } from "@/components/headers/menu-header";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { Badge } from "@/ui/badge";
import { Switch } from "@/ui/switch";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { parsePairingOfferUrl, type PairOfferErrorKey } from "@/utils/pair-offer";
import { buildRelayWebSocketUrl } from "@bytetrue/protocol/daemon-endpoints";
import { useTunnels, type AggregatedTunnelEntry, type TunnelLoadState } from "@/hooks/use-tunnels";
import {
  createTunnelFromSelection,
  grantTunnelDestination,
  tunnelEndStates,
  listenHostIsOpen,
  isLoopbackTargetHost,
  isLoopbackListenHost,
  DEFAULT_LISTEN_HOST,
} from "@/tunnels/tunnel-rule";
import {
  resolveTunnelPeerTarget,
  resolveTunnelPeerTargets,
  type TunnelPeerTarget,
} from "@/tunnels/tunnel-peer-targets";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostFeature } from "@/runtime/host-features";
import {
  useHosts,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  getHostRuntimeStore,
} from "@/runtime/host-runtime";
import { SelectField, type SelectFieldDisplay } from "@/widgets/select-field";
import type { MutableDaemonConfig } from "@bytetrue/protocol/messages";
import type { HostProfile } from "@/types/host-connection";
import { Input } from "@/ui/input";
import { Field, FieldLabel } from "@/ui/field";
import { Item, ItemGroup } from "@/ui/item";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";

type FormState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; entry: AggregatedTunnelEntry };

function MutedSpinner(): ReactElement {
  return (
    <span className="flex text-muted-foreground">
      <Spinner className="size-3.5" />
    </span>
  );
}

// size-3.5 keeps the icon at its 14px inside an xs button (shadcn sizes unclassed icons to 12px).
const TRASH_ICON = <Trash2 size={14} className="size-3.5 text-muted-foreground" />;

const EMPTY_TUNNEL_ENTRIES: AggregatedTunnelEntry[] = [];

function outboundPeerId(entry: AggregatedTunnelEntry): string {
  return entry.tunnelId.split(":")[0];
}

function parsePortToken(token: string): number | null {
  const n = Number.parseInt(token, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535 || String(n) !== token) {
    return null;
  }
  return n;
}

function parsePortList(raw: string): number[] | null {
  const tokens = raw
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const out: number[] = [];
  for (const tok of tokens) {
    const n = parsePortToken(tok);
    if (n === null) {
      return null;
    }
    if (!out.includes(n)) {
      out.push(n);
    }
  }
  return out;
}

// buildForwards pins each rule's local port and its destinations. Loopback is the daemon default on
// both ends and is not sent, so a daemon that does not know a field keeps the visible meaning.
function buildForwards(input: {
  remotePorts: number[];
  localPorts?: number[];
  remoteHost: string;
  listenHost: string;
}): Array<{ remotePort: number; remoteHost?: string; localPort?: number; listenHost?: string }> {
  const targetHost = input.remoteHost.trim();
  const boundHost = input.listenHost.trim();
  return input.remotePorts.map((remotePort, idx) => {
    let localPort = remotePort;
    if (input.localPorts !== undefined) {
      localPort =
        input.localPorts.length === 1 && input.remotePorts.length === 1
          ? input.localPorts[0]
          : input.localPorts[idx];
    }
    return {
      remotePort,
      // Always stated, even for loopback: a request that omits the host means "this machine" to an
      // older daemon only, and the daemon refuses an unstated host when the port has two rules.
      remoteHost: targetHost || DEFAULT_LISTEN_HOST,
      ...(boundHost && !isLoopbackListenHost(boundHost) ? { listenHost: boundHost } : {}),
      ...(localPort ? { localPort } : {}),
    };
  });
}

// grantIfDestinationChanged records the target's permission when an edit moves a rule to another
// destination. The grant is per destination, so the edited forward alone would be refused. Returns
// the message to show, or null when the destination did not change or the grant was written.
async function grantIfDestinationChanged(input: {
  entry: AggregatedTunnelEntry;
  peerId: string;
  hosts: readonly HostProfile[];
  remoteHost: string;
  remotePort: number;
}): Promise<string | null> {
  const nextHost = input.remoteHost.trim();
  const beforeHost = (input.entry.remoteHost ?? "").trim();
  const hostUnchanged =
    beforeHost === nextHost || (isLoopbackTargetHost(beforeHost) && isLoopbackTargetHost(nextHost));
  const unchanged = hostUnchanged && input.remotePort === input.entry.remotePort;
  if (unchanged) {
    return null;
  }
  const peerProfile = input.hosts.find((host) => host.serverId === input.peerId);
  const peerTarget = peerProfile ? resolveTunnelPeerTarget(peerProfile) : null;
  const grant = await grantTunnelDestination({
    targetClient: getHostRuntimeStore().getClient(input.peerId),
    sourceServerId: input.entry.serverId,
    targetServerId: input.peerId,
    targetPublicKey: peerTarget?.daemonPublicKeyB64 ?? null,
    hosts: input.hosts,
    host: input.remoteHost,
    port: input.remotePort,
  });
  return grant.ok ? null : (grant.error ?? "The target refused the grant.");
}

// formatHostPort renders an endpoint the way ssh does: brackets only for IPv6.
function formatHostPort(host: string, port: number | null): string {
  const value = host.trim().replace(/^\[|\]$/g, "");
  return value.includes(":") ? `[${value}]:${port ?? "—"}` : `${value}:${port ?? "—"}`;
}

// formatAllowedTarget is the allowlist's on-disk form: host:port, with brackets around an IPv6 host
// so the daemon can split it.
function formatAllowedTarget(host: string, port: number): string {
  const value = host.trim().replace(/^\[|\]$/g, "");
  return value.includes(":") ? `[${value}]:${port}` : `${value}:${port}`;
}

function parseAllowedTarget(raw: string): { host: string; port: number } | null {
  const separator = raw.lastIndexOf(":");
  if (separator < 0) {
    return null;
  }
  const host = raw
    .slice(0, separator)
    .trim()
    .replace(/^\[|\]$/g, "");
  const port = parsePortToken(raw.slice(separator + 1).trim());
  if (!host || port === null) {
    return null;
  }
  return { host, port };
}

// parseTargetList reads the allowlist field. A bare port is this machine; host:port is another
// machine on its network.
function parseTargetList(raw: string): {
  ports: number[];
  targets: { host: string; port: number }[];
} | null {
  const tokens = raw
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const ports: number[] = [];
  const targets: { host: string; port: number }[] = [];
  const addPort = (port: number) => {
    if (!ports.includes(port)) {
      ports.push(port);
    }
  };
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const port = parsePortToken(token);
      if (port === null) {
        return null;
      }
      addPort(port);
      continue;
    }
    const target = parseAllowedTarget(token);
    if (!target || /[^A-Za-z0-9.:_-]/.test(target.host)) {
      return null;
    }
    if (isLoopbackTargetHost(target.host)) {
      addPort(target.port);
      continue;
    }
    if (!targets.some((t) => t.host === target.host && t.port === target.port)) {
      targets.push(target);
    }
  }
  return { ports, targets };
}

interface AllowedRow {
  kind: "port" | "target";
  host: string;
  port: number;
}

export function TunnelsScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <div className={CONTAINER} />;
  }
  return <TunnelsScreenContent />;
}

function TunnelsScreenContent(): ReactElement {
  const { t } = useTranslation();
  const localDaemonServerId = useLocalDaemonServerId();
  const { loadState, refetch } = useTunnels();
  const { config, isLoading: configLoading } = useDaemonConfig(localDaemonServerId);
  const localDaemonSupportsTunnels = useHostFeature(localDaemonServerId, "daemonTunnels");
  const [formState, setFormState] = useState<FormState>({ mode: "closed" });

  const entries = loadState.status === "loaded" ? loadState.data : EMPTY_TUNNEL_ENTRIES;
  const tunnelsEnabled = config?.tunnel?.enabled === true;

  const openCreateForm = useCallback(() => {
    setFormState({ mode: "create" });
  }, []);
  const openEditForm = useCallback((entry: AggregatedTunnelEntry) => {
    setFormState({ mode: "edit", entry });
  }, []);
  const closeForm = useCallback(() => {
    setFormState({ mode: "closed" });
  }, []);
  const handleSaved = useCallback(() => {
    setFormState({ mode: "closed" });
    refetch();
  }, [refetch]);

  return (
    <div className={CONTAINER}>
      <MenuHeader title={t("tunnels.title")} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4">
          <TunnelsScreenBody
            localDaemonServerId={localDaemonServerId}
            config={config}
            configLoading={configLoading}
            tunnelsEnabled={tunnelsEnabled}
            localDaemonSupportsTunnels={localDaemonSupportsTunnels}
            entries={entries}
            loadState={loadState}
            onAddTunnel={openCreateForm}
            onEditTunnel={openEditForm}
            onRemoved={refetch}
          />
        </div>
      </div>
      {formState.mode === "create" && localDaemonServerId && tunnelsEnabled ? (
        <AddTunnelSheet
          localDaemonServerId={localDaemonServerId}
          entries={entries}
          onClose={closeForm}
          onCreated={handleSaved}
        />
      ) : undefined}
      {formState.mode === "edit" && localDaemonServerId && tunnelsEnabled ? (
        <EditTunnelSheet entry={formState.entry} onClose={closeForm} onSaved={handleSaved} />
      ) : undefined}
    </div>
  );
}

function TunnelsScreenBody(props: {
  localDaemonServerId: string | null;
  config: MutableDaemonConfig | null;
  configLoading: boolean;
  tunnelsEnabled: boolean;
  localDaemonSupportsTunnels: boolean;
  entries: AggregatedTunnelEntry[];
  loadState: TunnelLoadState;
  onAddTunnel: () => void;
  onEditTunnel: (entry: AggregatedTunnelEntry) => void;
  onRemoved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  if (!props.localDaemonServerId) {
    return (
      <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
        {t("tunnels.noLocalDaemon")}
      </span>
    );
  }
  if (!props.localDaemonSupportsTunnels) {
    return (
      <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
        {t("tunnels.hostTooOld")}
      </span>
    );
  }
  if (props.configLoading && !props.config) {
    return (
      <div className={LOADING_ROW}>
        <MutedSpinner />
        <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
          {t("common.states.loading")}
        </span>
      </div>
    );
  }
  if (!props.tunnelsEnabled) {
    return <TunnelEnableCard serverId={props.localDaemonServerId} />;
  }
  return (
    <TunnelsEnabledBody
      entries={props.entries}
      loadState={props.loadState}
      localDaemonServerId={props.localDaemonServerId}
      onAddTunnel={props.onAddTunnel}
      onEditTunnel={props.onEditTunnel}
      onRemoved={props.onRemoved}
    />
  );
}

function TunnelsEnabledBody({
  entries,
  loadState,
  localDaemonServerId,
  onAddTunnel,
  onEditTunnel,
  onRemoved,
}: {
  entries: AggregatedTunnelEntry[];
  loadState: TunnelLoadState;
  localDaemonServerId: string;
  onAddTunnel: () => void;
  onEditTunnel: (entry: AggregatedTunnelEntry) => void;
  onRemoved: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const [batchBusy, setBatchBusy] = useState(false);
  const forwardsTitle = isZh ? "端口转发 (Port forwards)" : "Port forwards";

  const outboundEntries = useMemo(
    () => entries.filter((e) => e.direction === "outbound"),
    [entries],
  );
  const hasDisabledOutbound = useMemo(
    () => outboundEntries.some((e) => e.disabled === true),
    [outboundEntries],
  );
  const hasActiveOutbound = useMemo(
    () => outboundEntries.some((e) => !e.disabled),
    [outboundEntries],
  );

  const setAllOutboundDisabled = useCallback(
    async (disabled: boolean) => {
      if (outboundEntries.length === 0) return;
      setBatchBusy(true);
      try {
        // An outbound rule lives on the host that listens, so the batch writes each host's rules to
        // that host. Sending them all to one daemon moved other hosts' rules onto it.
        const byHost = new Map<
          string,
          Map<
            string,
            {
              peerHostname?: string | null;
              forwards: Array<{
                remotePort: number;
                remoteHost?: string;
                localPort?: number;
                disabled: boolean;
              }>;
            }
          >
        >();
        for (const e of outboundEntries) {
          let byPeer = byHost.get(e.serverId);
          if (!byPeer) {
            byPeer = new Map();
            byHost.set(e.serverId, byPeer);
          }
          const pid = outboundPeerId(e);
          let group = byPeer.get(pid);
          if (!group) {
            group = { peerHostname: e.peerHostname, forwards: [] };
            byPeer.set(pid, group);
          }
          group.forwards.push({
            remotePort: e.remotePort,
            remoteHost: e.remoteHost || DEFAULT_LISTEN_HOST,
            ...(e.localPort ? { localPort: e.localPort } : {}),
            disabled,
          });
        }
        for (const [hostServerId, byPeer] of byHost) {
          const hostClient = getHostRuntimeStore().getClient(hostServerId);
          if (!hostClient) {
            continue;
          }
          for (const [peerId, group] of byPeer) {
            await hostClient.createTunnel({
              peerId,
              ...(group.peerHostname ? { peerHostname: group.peerHostname } : {}),
              forwards: group.forwards,
            });
          }
        }
        onRemoved();
      } catch {
        // Ignore transient batch errors
      } finally {
        setBatchBusy(false);
      }
    },
    [onRemoved, outboundEntries],
  );

  const handleStartAll = useCallback(() => {
    void setAllOutboundDisabled(false);
  }, [setAllOutboundDisabled]);

  const handlePauseAll = useCallback(() => {
    void setAllOutboundDisabled(true);
  }, [setAllOutboundDisabled]);

  const sectionTrailing = useMemo(
    () => (
      <div className="flex shrink-0 flex-row items-center gap-2">
        <Badge variant="secondary">{t("tunnels.experimental")}</Badge>
        {hasDisabledOutbound ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleStartAll}
            data-testid="tunnels-start-all"
            disabled={batchBusy}
          >
            {isZh ? "全部开启" : "Start all"}
          </Button>
        ) : undefined}
        {hasActiveOutbound ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePauseAll}
            data-testid="tunnels-pause-all"
            disabled={batchBusy}
          >
            {isZh ? "全部暂停" : "Pause all"}
          </Button>
        ) : undefined}
        <AddTunnelButton onPress={onAddTunnel} />
      </div>
    ),
    [
      batchBusy,
      handlePauseAll,
      handleStartAll,
      hasActiveOutbound,
      hasDisabledOutbound,
      isZh,
      onAddTunnel,
      t,
    ],
  );

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection title={forwardsTitle} trailing={sectionTrailing}>
        <TunnelsListBody
          localDaemonServerId={localDaemonServerId}
          loadState={loadState}
          entries={entries}
          onAddTunnel={onAddTunnel}
          onEditTunnel={onEditTunnel}
          onRemoved={onRemoved}
        />
      </SettingsSection>
      <AllowlistSection serverId={localDaemonServerId} />
    </div>
  );
}

function TunnelEnableCard({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const { patchConfig } = useDaemonConfig(serverId);
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = useCallback(() => {
    setEnabling(true);
    patchConfig({ tunnel: { enabled: true } })
      .catch(() => {
        setError(t("tunnels.enable.failed"));
      })
      .finally(() => {
        setEnabling(false);
      });
  }, [patchConfig, t]);

  return (
    <ItemGroup data-testid="tunnels-enable-card">
      <Item variant="outline" className="gap-3">
        <div className={ROW_CONTENT}>
          <span className="mb-2 text-sm leading-[normal] font-medium text-foreground">
            {t("tunnels.enable.title")}
          </span>
          <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
            {t("tunnels.enable.description")}
          </span>
          {error ? (
            <span className="mt-2 text-xs leading-[normal] text-red-300">{error}</span>
          ) : undefined}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={enable}
          data-testid="tunnels-enable"
          disabled={enabling}
        >
          {enabling ? t("tunnels.enable.enabling") : t("tunnels.enable.action")}
        </Button>
      </Item>
    </ItemGroup>
  );
}

function resolveBadgeClassName(state: AggregatedTunnelEntry["state"]): string | undefined {
  if (state === "connected") return "text-status-success";
  if (state === "error") return "text-status-danger";
  return undefined;
}

function AddTunnelButton({ onPress }: { onPress: () => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" onClick={onPress} data-testid="tunnels-add">
      <Plus data-icon="inline-start" />
      {t("tunnels.add")}
    </Button>
  );
}

function TunnelsListBody({
  localDaemonServerId,
  loadState,
  entries,
  onAddTunnel,
  onEditTunnel,
  onRemoved,
}: {
  localDaemonServerId: string | null;
  loadState: TunnelLoadState;
  entries: AggregatedTunnelEntry[];
  onAddTunnel: () => void;
  onEditTunnel: (entry: AggregatedTunnelEntry) => void;
  onRemoved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  if (!localDaemonServerId) {
    return (
      <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
        {t("tunnels.noLocalDaemon")}
      </span>
    );
  }
  if (loadState.status !== "loaded") {
    return (
      <ItemGroup>
        <div className={LOADING_ROW}>
          <MutedSpinner />
          <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
            {t("common.states.loading")}
          </span>
        </div>
      </ItemGroup>
    );
  }
  if (entries.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ArrowRightLeft />
          </EmptyMedia>
          <EmptyTitle>{t("tunnels.empty")}</EmptyTitle>
          <EmptyDescription>{t("tunnels.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onAddTunnel} data-testid="tunnels-empty-add">
            <Plus data-icon="inline-start" />
            {t("tunnels.add")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <ItemGroup>
      {entries.map((entry) => (
        <TunnelRow
          key={entry.serverId + ":" + entry.tunnelId}
          entry={entry}
          onEdit={onEditTunnel}
          onRemoved={onRemoved}
        />
      ))}
    </ItemGroup>
  );
}

function TunnelRow({
  entry,
  onEdit,
  onRemoved,
}: {
  entry: AggregatedTunnelEntry;
  onEdit: (entry: AggregatedTunnelEntry) => void;
  onRemoved: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const client = useHostRuntimeClient(entry.serverId);
  const isConnected = useHostRuntimeIsConnected(entry.serverId);
  const targetOnline = useHostRuntimeIsConnected(outboundPeerId(entry));
  const ends = tunnelEndStates({
    forwardState: entry.state,
    sourceOnline: isConnected,
    targetOnline,
  });

  const isPaused = entry.disabled === true;

  const stateLabel = useMemo(() => {
    if (isPaused) {
      return isZh ? "已暂停" : "Paused";
    }
    if (ends.source === "offline") {
      return t("tunnels.state.disconnected");
    }
    switch (entry.state) {
      case "connected":
        return t("tunnels.state.connected");
      case "connecting":
        return t("tunnels.state.connecting");
      case "error":
        return t("tunnels.state.error");
      default:
        return t("tunnels.state.disconnected");
    }
  }, [ends.source, entry.state, isPaused, isZh, t]);

  const isOutbound = entry.direction === "outbound";
  const badgeClassName = isPaused ? undefined : resolveBadgeClassName(entry.state);

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      if (!client || !isConnected || !isOutbound) return;
      void client
        .createTunnel({
          peerId: outboundPeerId(entry),
          ...(entry.peerHostname ? { peerHostname: entry.peerHostname } : {}),
          forwards: [
            {
              remotePort: entry.remotePort,
              remoteHost: entry.remoteHost || DEFAULT_LISTEN_HOST,
              ...(entry.localPort ? { localPort: entry.localPort } : {}),
              disabled: !enabled,
            },
          ],
        })
        .then(() => onRemoved())
        .catch(() => undefined);
    },
    [client, entry, isConnected, isOutbound, onRemoved],
  );

  const handleEdit = useCallback(() => {
    onEdit(entry);
  }, [entry, onEdit]);

  const remove = useCallback(() => {
    if (!client || !isConnected || !isOutbound) return;
    void client
      .removeTunnel(
        outboundPeerId(entry),
        undefined,
        entry.remotePort,
        entry.remoteHost || DEFAULT_LISTEN_HOST,
      )
      .then(() => onRemoved())
      .catch(() => undefined);
  }, [client, isConnected, isOutbound, entry, onRemoved]);

  const peerLabel = entry.peerHostname ?? outboundPeerId(entry);
  const remoteHost = entry.remoteHost ?? "";
  const localEndpoint = formatHostPort(
    entry.listenHost || DEFAULT_LISTEN_HOST,
    entry.localPort ?? null,
  );
  const remoteEndpoint = formatHostPort(
    isLoopbackTargetHost(remoteHost) ? peerLabel : remoteHost,
    entry.remotePort,
  );

  const subtitle = isOutbound
    ? t("tunnels.outboundSubtitle", {
        localPort: entry.localPort == null ? "—" : entry.localPort,
        host: entry.serverName,
      })
    : t("tunnels.inboundSubtitle", { host: entry.serverName });

  return (
    <Item
      variant="outline"
      data-testid={isOutbound ? "tunnels-row-outbound" : "tunnels-row-inbound"}
    >
      <div className={ROW_CONTENT}>
        {isOutbound ? (
          <div className="flex flex-row flex-wrap items-center gap-2">
            <Badge variant="secondary" data-testid="tunnels-row-local-port">
              {localEndpoint}
            </Badge>
            <ArrowRight size={13} className="shrink-0 text-muted-foreground" />
            <Badge variant="secondary">{remoteEndpoint}</Badge>
          </div>
        ) : (
          <div className="flex flex-row items-center gap-2">
            <span className="truncate text-sm leading-[normal] text-foreground">
              {t("tunnels.inboundFrom", { port: entry.remotePort })}
            </span>
          </div>
        )}
        <span className="truncate text-xs leading-[normal] text-muted-foreground">{subtitle}</span>
        {entry.lastError ? (
          <span className="line-clamp-2 text-xs leading-[normal] text-red-300">
            {entry.lastError}
          </span>
        ) : undefined}
      </div>
      <div className="flex flex-row items-center gap-2">
        <Badge variant="secondary" className={badgeClassName}>
          {stateLabel}
        </Badge>
        <Badge variant="outline">
          {ends.target === "offline" ? "target offline" : "target ok"}
        </Badge>
        {isOutbound ? (
          <>
            <Switch
              checked={!isPaused}
              onCheckedChange={handleToggleEnabled}
              disabled={!isConnected}
              aria-label={isZh ? "启用或暂停此端口转发" : "Enable or pause port forward"}
              data-testid="tunnels-row-toggle"
            />
            <Button
              variant="outline"
              size="xs"
              onClick={handleEdit}
              data-testid="tunnels-row-edit"
              disabled={!isConnected}
            >
              <Pencil data-icon="inline-start" />
              {isZh ? "改端口" : "Edit"}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={remove}
              aria-label={isZh ? "删除此端口转发" : "Remove port forward"}
              data-testid="tunnels-row-delete"
              disabled={!isConnected}
            >
              {TRASH_ICON}
            </Button>
          </>
        ) : undefined}
      </div>
    </Item>
  );
}

function AllowlistSection({ serverId }: { serverId: string }): ReactElement | null {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [draft, setDraft] = useState("");
  const handleDraftInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [setDraft],
  );
  const [resetSeq, setResetSeq] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allowedPorts = useMemo(() => config?.tunnel?.allowedPorts ?? [], [config]);
  const allowedTargets = useMemo(() => config?.tunnel?.allowedTargets ?? [], [config]);
  const rows = useMemo<AllowedRow[]>(() => {
    const parsed: AllowedRow[] = allowedPorts.map((port) => ({
      kind: "port",
      host: DEFAULT_LISTEN_HOST,
      port,
    }));
    for (const text of allowedTargets) {
      const target = parseAllowedTarget(text);
      if (target) {
        parsed.push({ kind: "target", host: target.host, port: target.port });
      }
    }
    return parsed;
  }, [allowedPorts, allowedTargets]);

  const addTargetsAsync = useCallback(async () => {
    const parsed = parseTargetList(draft);
    if (!parsed) {
      setError(t("tunnels.allowlist.invalidPort"));
      return;
    }
    const mergedPorts = [...allowedPorts];
    for (const port of parsed.ports) {
      if (!mergedPorts.includes(port)) {
        mergedPorts.push(port);
      }
    }
    mergedPorts.sort((a, b) => a - b);
    const mergedTargets = [...allowedTargets];
    for (const target of parsed.targets) {
      const text = formatAllowedTarget(target.host, target.port);
      if (!mergedTargets.includes(text)) {
        mergedTargets.push(text);
      }
    }
    mergedTargets.sort();
    if (
      mergedPorts.length === allowedPorts.length &&
      mergedTargets.length === allowedTargets.length
    ) {
      setDraft("");
      setResetSeq((n) => n + 1);
      setError(null);
      return;
    }
    setSaving(true);
    try {
      await patchConfig({ tunnel: { allowedPorts: mergedPorts, allowedTargets: mergedTargets } });
      setDraft("");
      setResetSeq((n) => n + 1);
      setError(null);
    } catch {
      setError(t("tunnels.allowlist.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [draft, allowedPorts, allowedTargets, patchConfig, t]);

  const addTargets = useCallback(() => {
    void addTargetsAsync();
  }, [addTargetsAsync]);
  const handleAddTargetsEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) addTargets();
    },
    [addTargets],
  );

  const removeRow = useCallback(
    async (row: AllowedRow) => {
      setSaving(true);
      try {
        if (row.kind === "port") {
          await patchConfig({
            tunnel: { allowedPorts: allowedPorts.filter((p) => p !== row.port) },
          });
        } else {
          const text = formatAllowedTarget(row.host, row.port);
          await patchConfig({
            tunnel: { allowedTargets: allowedTargets.filter((target) => target !== text) },
          });
        }
      } catch {
        setError(t("tunnels.allowlist.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [allowedPorts, allowedTargets, patchConfig, t],
  );
  const makeRemoveRowHandler = useCallback(
    (row: AllowedRow) => () => {
      void removeRow(row);
    },
    [removeRow],
  );

  if (!config) {
    return null;
  }

  return (
    <SettingsSection title={t("tunnels.allowlist.title")}>
      <ItemGroup>
        <Item variant="outline" className="gap-2">
          <Input
            className="flex-1"
            defaultValue={draft}
            key={resetSeq}
            onChange={handleDraftInput}
            onKeyDown={handleAddTargetsEnter}
            placeholder={t("tunnels.allowlist.portPlaceholder")}
            data-testid="tunnels-allowlist-input"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={addTargets}
            disabled={saving || draft.trim().length === 0}
          >
            {saving ? t("tunnels.allowlist.saving") : t("tunnels.allowlist.add")}
          </Button>
        </Item>
        {rows.length === 0 ? (
          <Item variant="outline">
            <span className="text-xs leading-[normal] text-muted-foreground">
              {t("tunnels.allowlist.empty")}
            </span>
          </Item>
        ) : (
          rows.map((row) => (
            <Item variant="outline" key={row.kind + ":" + row.host + ":" + row.port}>
              <div className="flex flex-1 flex-row items-center gap-3">
                <Badge variant="secondary">{formatHostPort(row.host, row.port)}</Badge>
                {row.kind === "port" ? (
                  <span className="text-xs leading-[normal] text-muted-foreground">
                    {t("tunnels.allowlist.port", { port: row.port })}
                  </span>
                ) : undefined}
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={makeRemoveRowHandler(row)}
                disabled={saving}
              >
                {TRASH_ICON}
              </Button>
            </Item>
          ))
        )}
      </ItemGroup>
      {error ? (
        <span className="block mt-2 text-xs leading-[normal] text-red-300">{error}</span>
      ) : undefined}
      <span className="block mt-2 text-xs leading-[normal] text-muted-foreground">
        {t("tunnels.allowlist.hint")}
      </span>
    </SettingsSection>
  );
}

const PASTE_OFFER_OPTION_ID = "paste-offer";

async function createTunnelFromOffer(input: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  offerUrl: string;
  password: string;
  forwards: Array<{
    remotePort: number;
    remoteHost?: string;
    localPort?: number;
    listenHost?: string;
  }>;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = parsePairingOfferUrl(input.offerUrl);
  if (!parsed.ok) {
    return { ok: false };
  }
  const offer = parsed.offer;
  return input.client.createTunnel({
    peerId: offer.serverId,
    peerHostname: offer.hostname,
    url: buildRelayWebSocketUrl({
      endpoint: offer.relay.endpoint,
      useTls: offer.relay.useTls ?? true,
      serverId: offer.serverId,
      role: "client",
    }),
    ...(input.password ? { password: input.password } : {}),
    daemonPublicKeyB64: offer.daemonPublicKeyB64,
    forwards: input.forwards,
  });
}

type TunnelPeerSelection =
  | { kind: "host"; target: TunnelPeerTarget }
  | { kind: "offer"; url: string };

function ListenHostField({
  isZh,
  listenHost,
  onChange,
  testID = "tunnels-add-listen-host",
}: {
  isZh: boolean;
  listenHost: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  testID?: string;
}): ReactElement {
  return (
    <Field>
      <FieldLabel>{isZh ? "监听地址" : "Listen address"}</FieldLabel>
      <Input value={listenHost} onChange={onChange} data-testid={testID} />
      {listenHostIsOpen(listenHost) ? (
        <span className="text-xs leading-[normal] text-red-300">
          {isZh
            ? "这个地址对网络开放，任何能访问这台机器的人都能连上转发的端口。"
            : "This address is open to the network. Anyone who can reach this machine can connect to the forwarded port."}
        </span>
      ) : null}
    </Field>
  );
}

function RemoteHostField({
  isZh,
  remoteHost,
  onChange,
  testID = "tunnels-add-remote-host-input",
  label,
}: {
  isZh: boolean;
  remoteHost: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  testID?: string;
  label?: string;
}): ReactElement {
  return (
    <Field>
      <FieldLabel>{label ?? (isZh ? "远端主机（可选，默认对端本机）" : "Remote host")}</FieldLabel>
      <Input
        defaultValue={remoteHost}
        onChange={onChange}
        placeholder="127.0.0.1"
        autoCapitalize="none"
        autoCorrect="off"
        data-testid={testID}
      />
      <span className="text-xs leading-[normal] text-muted-foreground">
        {isZh
          ? "对端网络上要连的机器。对端的白名单需要放行这个地址和端口。"
          : "The machine to reach on the paired host's network. Its allowlist must include this destination."}
      </span>
    </Field>
  );
}

// tunnelSourceLabel names the listening end in the add form; the other selector names the port's host.
function tunnelSourceLabel(isZh: boolean): string {
  return isZh ? "监听主机" : "Listen on";
}

// nextTargetAfterSourceChange keeps the two selectors from naming the same host. Changing the
// listening host only replaces the target when it was that same host (the paste-offer choice is
// never a host and stays).
function nextTargetAfterSourceChange(
  targets: readonly TunnelPeerTarget[],
  sourceServerId: string,
  currentPeerId: string,
): { serverId: string; password: string } {
  const current = targets.find((target) => target.serverId === currentPeerId);
  if (currentPeerId === PASTE_OFFER_OPTION_ID || currentPeerId !== sourceServerId) {
    return { serverId: currentPeerId, password: current?.password ?? "" };
  }
  const fallback = targets.find((target) => target.serverId !== sourceServerId);
  if (!fallback) {
    return { serverId: PASTE_OFFER_OPTION_ID, password: "" };
  }
  return { serverId: fallback.serverId, password: fallback.password ?? "" };
}

function SourceTunnelHint({
  isZh,
  config,
}: {
  isZh: boolean;
  config: MutableDaemonConfig | null;
}): ReactElement | null {
  if (!config || config.tunnel?.enabled === true) {
    return null;
  }
  return (
    <span className="text-xs leading-[normal] text-red-300">
      {isZh
        ? "这台主机没有开启隧道功能，规则会保存但不会开始监听。"
        : "Tunnels are disabled on this host; the rule is saved but will not listen."}
    </span>
  );
}

function AddTunnelSheet({
  localDaemonServerId,
  entries,
  onClose,
  onCreated,
}: {
  localDaemonServerId: string;
  entries: AggregatedTunnelEntry[];
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const hosts = useHosts();
  const peerTargets = useMemo(() => resolveTunnelPeerTargets(hosts), [hosts]);
  // Both ends are hosts in the chain: "Listen on" chooses the daemon that opens the local port, and
  // the paired host chooses whose port is exposed. The local daemon is only the default listener.
  const [sourceServerId, setSourceServerId] = useState<string>(() =>
    peerTargets.some((target) => target.serverId === localDaemonServerId)
      ? localDaemonServerId
      : (peerTargets[0]?.serverId ?? ""),
  );
  const sourceClient = useHostRuntimeClient(sourceServerId);
  const { config: sourceConfig } = useDaemonConfig(sourceServerId);
  const selectableTargets = useMemo(
    () => peerTargets.filter((target) => target.serverId !== sourceServerId),
    [peerTargets, sourceServerId],
  );
  const existingPeerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.direction === "outbound" && entry.serverId === sourceServerId) {
        ids.add(outboundPeerId(entry));
      }
    }
    return ids;
  }, [entries, sourceServerId]);

  const [selectedPeerId, setSelectedPeerId] = useState<string>(
    selectableTargets[0]?.serverId ?? PASTE_OFFER_OPTION_ID,
  );
  const [offerUrl, setOfferUrl] = useState("");
  const handleOfferUrlInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setOfferUrl(event.target.value),
    [setOfferUrl],
  );
  const [password, setPassword] = useState(selectableTargets[0]?.password ?? "");
  const handlePasswordInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value),
    [setPassword],
  );
  const [remotePort, setRemotePort] = useState("");
  const [remoteHost, setRemoteHost] = useState("");
  const handleRemoteHostInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setRemoteHost(event.target.value),
    [],
  );
  const [listenHost, setListenHost] = useState(DEFAULT_LISTEN_HOST);
  const handleListenHostInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setListenHost(event.target.value),
    [],
  );
  const handleRemotePortInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setRemotePort(event.target.value),
    [setRemotePort],
  );
  const [localPort, setLocalPort] = useState("");
  const handleLocalPortInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setLocalPort(event.target.value),
    [setLocalPort],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedTarget = useMemo(
    () => selectableTargets.find((target) => target.serverId === selectedPeerId) ?? null,
    [selectableTargets, selectedPeerId],
  );
  const isPastingOffer = selectedTarget === null;
  const parsedOffer = useMemo(
    () => (isPastingOffer && offerUrl.trim() ? parsePairingOfferUrl(offerUrl) : null),
    [isPastingOffer, offerUrl],
  );
  const hasPublicKeyAuth = Boolean(
    selectedTarget?.daemonPublicKeyB64 || (parsedOffer?.ok && parsedOffer.offer.daemonPublicKeyB64),
  );
  const passwordOptional = Boolean(
    hasPublicKeyAuth || (selectedTarget && existingPeerIds.has(selectedTarget.serverId)),
  );

  const peerOptions = useMemo(
    () => [
      ...selectableTargets.map((target) => ({
        id: target.serverId,
        value: target.serverId,
        label: target.label,
        description: target.viaRelay
          ? t("tunnels.addForm.peerViaRelay")
          : t("tunnels.addForm.peerDirect"),
        testID: "tunnels-add-peer-option-" + target.serverId,
      })),
      {
        id: PASTE_OFFER_OPTION_ID,
        value: PASTE_OFFER_OPTION_ID,
        label: t("tunnels.addForm.pasteOffer"),
        description: t("tunnels.addForm.pasteOfferDescription"),
        testID: "tunnels-add-peer-option-paste",
      },
    ],
    [selectableTargets, t],
  );

  const selectedPeerDisplay = useMemo<SelectFieldDisplay>(() => {
    if (!selectedTarget) {
      return {
        label: t("tunnels.addForm.pasteOffer"),
        description: t("tunnels.addForm.pasteOfferDescription"),
      };
    }
    return {
      label: selectedTarget.label,
      description: selectedTarget.viaRelay
        ? t("tunnels.addForm.peerViaRelay")
        : t("tunnels.addForm.peerDirect"),
    };
  }, [selectedTarget, t]);

  const handlePeerChange = useCallback(
    (value: string) => {
      setSelectedPeerId(value);
      setError(null);
      const target = selectableTargets.find((candidate) => candidate.serverId === value);
      setPassword(target?.password ?? "");
    },
    [selectableTargets],
  );

  const selectedSource = useMemo(
    () => peerTargets.find((target) => target.serverId === sourceServerId) ?? null,
    [peerTargets, sourceServerId],
  );
  const sourceOptions = useMemo(
    () =>
      peerTargets.map((target) => ({
        id: target.serverId,
        value: target.serverId,
        label: target.label,
        description: target.viaRelay
          ? t("tunnels.addForm.peerViaRelay")
          : t("tunnels.addForm.peerDirect"),
        testID: "tunnels-add-source-option-" + target.serverId,
      })),
    [peerTargets, t],
  );
  const sourceDisplay = useMemo<SelectFieldDisplay>(
    () =>
      selectedSource
        ? {
            label: selectedSource.label,
            description: selectedSource.viaRelay
              ? t("tunnels.addForm.peerViaRelay")
              : t("tunnels.addForm.peerDirect"),
          }
        : { label: "", description: "" },
    [selectedSource, t],
  );
  const handleSourceChange = useCallback(
    (value: string) => {
      setSourceServerId(value);
      setError(null);
      const next = nextTargetAfterSourceChange(peerTargets, value, selectedPeerId);
      setSelectedPeerId(next.serverId);
      setPassword(next.password);
    },
    [peerTargets, selectedPeerId],
  );

  const resolveSelection = useCallback((): TunnelPeerSelection | null => {
    if (selectedTarget) {
      return { kind: "host", target: selectedTarget };
    }
    const parsed = parsePairingOfferUrl(offerUrl);
    if (!parsed.ok) {
      setError(t("pairing.link.errors." + (parsed.errorKey as PairOfferErrorKey)));
      return null;
    }
    return { kind: "offer", url: offerUrl };
  }, [offerUrl, selectedTarget, t]);

  const submitAsync = useCallback(async () => {
    if (!sourceClient) {
      setError(t("workspace.terminal.hostDisconnected"));
      return;
    }
    const remotePorts = parsePortList(remotePort);
    if (!remotePorts) {
      setError(t("tunnels.addForm.invalidPort"));
      return;
    }
    let parsedLocalPorts: number[] | undefined;
    if (localPort.trim().length > 0) {
      const lps = parsePortList(localPort);
      if (!lps || (lps.length !== 1 && lps.length !== remotePorts.length)) {
        setError(t("tunnels.addForm.invalidPort"));
        return;
      }
      parsedLocalPorts = lps;
    }
    if (!password && !passwordOptional) {
      setError(t("tunnels.addForm.passwordRequired"));
      return;
    }
    const selection = resolveSelection();
    if (!selection) return;

    const forwards = buildForwards({
      remotePorts,
      localPorts: parsedLocalPorts,
      remoteHost,
      listenHost,
    });

    setSubmitting(true);
    try {
      const response = await createTunnelFromSelection({
        selection,
        sourceServerId,
        hosts,
        sourceClient,
        targetClient:
          selection.kind === "host"
            ? getHostRuntimeStore().getClient(selection.target.serverId)
            : null,
        forwards,
        listenHost,
        createOneSided: () =>
          selection.kind === "host"
            ? sourceClient.createTunnel({
                peerId: selection.target.serverId,
                peerHostname: selection.target.label,
                url: selection.target.url,
                ...(password ? { password } : {}),
                ...(selection.target.daemonPublicKeyB64
                  ? { daemonPublicKeyB64: selection.target.daemonPublicKeyB64 }
                  : {}),
                forwards,
              })
            : createTunnelFromOffer({
                client: sourceClient,
                offerUrl: selection.url,
                password,
                forwards,
              }),
      });
      if (!response.ok) {
        setError(response.error ?? t("tunnels.addForm.failed"));
        return;
      }
      onCreated();
    } catch {
      setError(t("tunnels.addForm.failed"));
    } finally {
      setSubmitting(false);
    }
  }, [
    hosts,
    listenHost,
    localPort,
    password,
    onCreated,
    passwordOptional,
    remoteHost,
    remotePort,
    resolveSelection,
    sourceClient,
    sourceServerId,
    t,
  ]);

  const submit = useCallback(() => {
    void submitAsync();
  }, [submitAsync]);
  const handleSubmitEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
    },
    [submit],
  );

  const header = useMemo<SheetHeader>(() => ({ title: t("tunnels.addForm.title") }), [t]);

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} testID="tunnels-add-sheet">
      <SelectField
        label={tunnelSourceLabel(isZh)}
        value={sourceServerId}
        selectedDisplay={sourceDisplay}
        options={sourceOptions}
        onChange={handleSourceChange}
        placeholder={t("tunnels.addForm.peerPlaceholder")}
        emptyText={t("common.empty.noOptionsMatchSearch")}
        searchable={peerTargets.length > 6}
        testID="tunnels-add-source"
        triggerTestID="tunnels-add-source-trigger"
      />
      <SourceTunnelHint isZh={isZh} config={sourceConfig} />
      <SelectField
        label={t("tunnels.addForm.peerLabel")}
        value={selectedPeerId}
        selectedDisplay={selectedPeerDisplay}
        options={peerOptions}
        onChange={handlePeerChange}
        placeholder={t("tunnels.addForm.peerPlaceholder")}
        emptyText={t("common.empty.noOptionsMatchSearch")}
        searchable={selectableTargets.length > 6}
        testID="tunnels-add-peer"
        triggerTestID="tunnels-add-peer-trigger"
      />
      {isPastingOffer ? (
        <Field>
          <FieldLabel>{t("tunnels.addForm.offerLabel")}</FieldLabel>
          <Input
            defaultValue={offerUrl}
            onChange={handleOfferUrlInput}
            placeholder={t("tunnels.addForm.offerPlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            data-testid="tunnels-add-offer-input"
          />
        </Field>
      ) : undefined}
      {!passwordOptional ? (
        <Field>
          <FieldLabel>{t("tunnels.addForm.passwordLabel")}</FieldLabel>
          <Input
            defaultValue={password}
            key={selectedPeerId}
            onChange={handlePasswordInput}
            placeholder={t("tunnels.addForm.passwordPlaceholder")}
            type="password"
            data-testid="tunnels-add-password-input"
          />
        </Field>
      ) : undefined}
      <ListenHostField isZh={isZh} listenHost={listenHost} onChange={handleListenHostInput} />
      <RemoteHostField isZh={isZh} remoteHost={remoteHost} onChange={handleRemoteHostInput} />
      <Field>
        <FieldLabel>
          {isZh ? "远端端口（支持填多个，如 3425, 3430）" : t("tunnels.addForm.remotePortLabel")}
        </FieldLabel>
        <Input
          defaultValue={remotePort}
          onChange={handleRemotePortInput}
          placeholder="3425, 3430"
          inputMode="numeric"
          data-testid="tunnels-add-port-input"
        />
      </Field>
      <Field>
        <FieldLabel>
          {isZh
            ? "本地固定端口（可选，不填默认与远端端口相同）"
            : "Local port (optional, defaults to same as remote port)"}
        </FieldLabel>
        <Input
          defaultValue={localPort}
          onChange={handleLocalPortInput}
          onKeyDown={handleSubmitEnter}
          placeholder={remotePort.trim() || "3425, 3430"}
          inputMode="numeric"
          data-testid="tunnels-add-local-port-input"
        />
      </Field>
      {error ? (
        <span className="mt-2 text-xs leading-[normal] text-red-300">{error}</span>
      ) : undefined}
      <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
        {t("tunnels.addForm.hint")}
      </span>
      <div className={SHEET_ACTIONS}>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button variant="default" onClick={submit} disabled={submitting}>
          {submitting ? t("tunnels.addForm.submitting") : t("tunnels.add")}
        </Button>
      </div>
    </AdaptiveModalSheet>
  );
}

function resolveEditSaveButtonLabel(
  submitting: boolean,
  isZh: boolean,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (submitting) {
    return t("common.states.loading");
  }
  return isZh ? "保存并重绑" : "Save";
}

function EditTunnelSheet({
  entry,
  onClose,
  onSaved,
}: {
  entry: AggregatedTunnelEntry;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const client = useHostRuntimeClient(entry.serverId);
  const hosts = useHosts();
  const [remotePort, setRemotePort] = useState(String(entry.remotePort));
  const handleRemotePortInput2 = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setRemotePort(event.target.value),
    [setRemotePort],
  );
  // Kept even when the daemon has no host support, so saving an untouched rule does not silently
  // rewrite its destination to loopback.
  const [remoteHost, setRemoteHost] = useState(entry.remoteHost ?? "");
  const handleRemoteHostInput2 = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setRemoteHost(event.target.value),
    [setRemoteHost],
  );
  const [listenHost, setListenHost] = useState(entry.listenHost || DEFAULT_LISTEN_HOST);
  const handleListenHostInput2 = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setListenHost(event.target.value),
    [setListenHost],
  );
  const [localPort, setLocalPort] = useState(
    entry.localPort != null ? String(entry.localPort) : String(entry.remotePort),
  );
  const handleLocalPortInput2 = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setLocalPort(event.target.value),
    [setLocalPort],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const peerId = outboundPeerId(entry);
  const peerLabel = entry.peerHostname ?? peerId;

  const saveAsync = useCallback(async () => {
    if (!client) {
      setError(t("workspace.terminal.hostDisconnected"));
      return;
    }
    const rp = Number.parseInt(remotePort.trim(), 10);
    const lp = Number.parseInt(localPort.trim(), 10);
    if (
      !Number.isInteger(rp) ||
      rp < 1 ||
      rp > 65535 ||
      !Number.isInteger(lp) ||
      lp < 1 ||
      lp > 65535
    ) {
      setError(t("tunnels.addForm.invalidPort"));
      return;
    }

    setSubmitting(true);
    try {
      const grantError = await grantIfDestinationChanged({
        entry,
        peerId,
        hosts,
        remoteHost,
        remotePort: rp,
      });
      if (grantError) {
        setError(grantError);
        return;
      }
      // The stored rule may ask for 0.0.0.0 while the bound address reads "::" (dual stack). Sending
      // the bound address back would rewrite the rule, so an untouched field is not restated at all
      // and the daemon keeps the interface it already has.
      const boundListenHost = entry.listenHost?.trim() || DEFAULT_LISTEN_HOST;
      const nextListenHost = listenHost.trim() || DEFAULT_LISTEN_HOST;
      const response = await client.createTunnel({
        peerId,
        ...(entry.peerHostname ? { peerHostname: entry.peerHostname } : {}),
        replaceRemotePort: entry.remotePort,
        replaceRemoteHost: entry.remoteHost ?? "",
        forwards: [
          {
            remotePort: rp,
            remoteHost: remoteHost.trim() || DEFAULT_LISTEN_HOST,
            localPort: lp,
            ...(nextListenHost === boundListenHost ? {} : { listenHost: nextListenHost }),
          },
        ],
      });
      if (!response.ok) {
        setError(response.error ?? t("tunnels.addForm.failed"));
        return;
      }
      onSaved();
    } catch {
      setError(t("tunnels.addForm.failed"));
    } finally {
      setSubmitting(false);
    }
  }, [client, entry, hosts, listenHost, localPort, onSaved, peerId, remoteHost, remotePort, t]);

  const save = useCallback(() => {
    void saveAsync();
  }, [saveAsync]);
  const handleSaveEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) save();
    },
    [save],
  );

  const header = useMemo<SheetHeader>(
    () => ({
      title: isZh ? `修改端口转发 · ${peerLabel}` : `Edit port forward · ${peerLabel}`,
    }),
    [isZh, peerLabel],
  );

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} testID="tunnels-edit-sheet">
      <ListenHostField
        isZh={isZh}
        listenHost={listenHost}
        onChange={handleListenHostInput2}
        testID="tunnels-edit-listen-host"
      />
      <Field>
        <FieldLabel>{isZh ? "本地监听端口" : "Local port"}</FieldLabel>
        <Input
          defaultValue={localPort}
          onChange={handleLocalPortInput2}
          onKeyDown={handleSaveEnter}
          placeholder="3425"
          inputMode="numeric"
          data-testid="tunnels-edit-local-port-input"
        />
      </Field>
      <RemoteHostField
        isZh={isZh}
        remoteHost={remoteHost}
        onChange={handleRemoteHostInput2}
        testID="tunnels-edit-remote-host-input"
        label={isZh ? `远端主机（${peerLabel} 网络）` : `Remote host (on ${peerLabel})`}
      />
      <Field>
        <FieldLabel>{isZh ? "远端目标端口" : "Remote port"}</FieldLabel>
        <Input
          defaultValue={remotePort}
          onChange={handleRemotePortInput2}
          onKeyDown={handleSaveEnter}
          placeholder="3425"
          inputMode="numeric"
          data-testid="tunnels-edit-remote-port-input"
        />
      </Field>
      {error ? (
        <span className="mt-2 text-xs leading-[normal] text-red-300">{error}</span>
      ) : undefined}
      <div className={SHEET_ACTIONS}>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          onClick={save}
          data-testid="tunnels-edit-save"
          disabled={submitting}
        >
          {resolveEditSaveButtonLabel(submitting, isZh, t)}
        </Button>
      </div>
    </AdaptiveModalSheet>
  );
}

const CONTAINER = "flex min-h-0 flex-1 flex-col bg-background";
const LOADING_ROW = "flex flex-row items-center gap-2 p-4";
const ROW_CONTENT = "flex min-w-0 flex-1 flex-col gap-1";
const SHEET_ACTIONS = "mt-2 flex flex-row justify-end gap-2";
