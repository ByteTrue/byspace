// Port of archive/expo-app:packages/app/src/screens/tunnels-screen.tsx: the Tunnels page and its add / edit sheets; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/tunnels-screen.py; edit it directly.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useIsFocused } from "~/app/route-focus";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowRightLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";
import { MenuHeader } from "@/components/headers/menu-header";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { parsePairingOfferUrl, type PairOfferErrorKey } from "@/utils/pair-offer";
import { buildRelayWebSocketUrl } from "@bytetrue/protocol/daemon-endpoints";
import { useTunnels, type AggregatedTunnelEntry, type TunnelLoadState } from "@/hooks/use-tunnels";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostFeature } from "@/runtime/host-features";
import { useHosts, useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SelectField, type SelectFieldDisplay } from "@/components/ui/select-field";
import { resolveTunnelPeerTargets, type TunnelPeerTarget } from "@/tunnels/tunnel-peer-targets";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import type { MutableDaemonConfig } from "@bytetrue/protocol/messages";

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
    const n = Number.parseInt(tok, 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535 || String(n) !== tok) {
      return null;
    }
    if (!out.includes(n)) {
      out.push(n);
    }
  }
  return out;
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

  const existingPeerIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (e.direction === "outbound") {
        s.add(outboundPeerId(e));
      }
    }
    return s;
  }, [entries]);

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
          serverId={localDaemonServerId}
          existingPeerIds={existingPeerIds}
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
  const client = useHostRuntimeClient(localDaemonServerId);
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
      if (!client || outboundEntries.length === 0) return;
      setBatchBusy(true);
      try {
        const byPeer = new Map<
          string,
          {
            peerHostname?: string | null;
            forwards: Array<{ remotePort: number; localPort?: number; disabled: boolean }>;
          }
        >();
        for (const e of outboundEntries) {
          const pid = outboundPeerId(e);
          let group = byPeer.get(pid);
          if (!group) {
            group = { peerHostname: e.peerHostname, forwards: [] };
            byPeer.set(pid, group);
          }
          group.forwards.push({
            remotePort: e.remotePort,
            ...(e.localPort ? { localPort: e.localPort } : {}),
            disabled,
          });
        }
        for (const [peerId, group] of byPeer) {
          await client.createTunnel({
            peerId,
            ...(group.peerHostname ? { peerHostname: group.peerHostname } : {}),
            forwards: group.forwards,
          });
        }
        onRemoved();
      } catch {
        // Ignore transient batch errors
      } finally {
        setBatchBusy(false);
      }
    },
    [client, onRemoved, outboundEntries],
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
            onPress={handleStartAll}
            disabled={batchBusy}
            testID="tunnels-start-all"
          >
            {isZh ? "全部开启" : "Start all"}
          </Button>
        ) : undefined}
        {hasActiveOutbound ? (
          <Button
            variant="secondary"
            size="sm"
            onPress={handlePauseAll}
            disabled={batchBusy}
            testID="tunnels-pause-all"
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
    <div className={settingsStyles.card} data-testid="tunnels-enable-card">
      <div className={cn(settingsStyles.row, "gap-3")}>
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
          onPress={enable}
          disabled={enabling}
          testID="tunnels-enable"
        >
          {enabling ? t("tunnels.enable.enabling") : t("tunnels.enable.action")}
        </Button>
      </div>
    </div>
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
    <Button variant="outline" size="sm" leftIcon={Plus} onPress={onPress} testID="tunnels-add">
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
      <div className={settingsStyles.card}>
        <div className={LOADING_ROW}>
          <MutedSpinner />
          <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
            {t("common.states.loading")}
          </span>
        </div>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className={settingsStyles.card}>
        <div className="flex flex-col items-center gap-4 px-4 py-6">
          <ArrowRightLeft size={ICON_SIZE.lg} className="text-muted-foreground" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm leading-[normal] text-foreground">{t("tunnels.empty")}</span>
            <span className="text-center text-xs leading-[normal] text-muted-foreground">
              {t("tunnels.emptyDescription")}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            leftIcon={Plus}
            onPress={onAddTunnel}
            testID="tunnels-empty-add"
          >
            {t("tunnels.add")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={settingsStyles.card}>
      {entries.map((entry, index) => (
        <TunnelRow
          key={entry.serverId + ":" + entry.tunnelId}
          entry={entry}
          isLast={index === entries.length - 1}
          onEdit={onEditTunnel}
          onRemoved={onRemoved}
        />
      ))}
    </div>
  );
}

function TunnelRow({
  entry,
  isLast,
  onEdit,
  onRemoved,
}: {
  entry: AggregatedTunnelEntry;
  isLast: boolean;
  onEdit: (entry: AggregatedTunnelEntry) => void;
  onRemoved: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const client = useHostRuntimeClient(entry.serverId);
  const isConnected = useHostRuntimeIsConnected(entry.serverId);

  const isPaused = entry.disabled === true;

  const stateLabel = useMemo(() => {
    if (isPaused) {
      return isZh ? "已暂停" : "Paused";
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
  }, [entry.state, isPaused, isZh, t]);

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
      .removeTunnel(outboundPeerId(entry), undefined, entry.remotePort)
      .then(() => onRemoved())
      .catch(() => undefined);
  }, [client, isConnected, isOutbound, entry, onRemoved]);

  const peerLabel = entry.peerHostname ?? outboundPeerId(entry);
  const localEndpoint = entry.localPort == null ? "127.0.0.1:—" : `127.0.0.1:${entry.localPort}`;
  const remoteEndpoint = `${peerLabel}:${entry.remotePort}`;

  const subtitle = isOutbound
    ? t("tunnels.outboundSubtitle", {
        localPort: entry.localPort == null ? "—" : entry.localPort,
        host: entry.serverName,
      })
    : t("tunnels.inboundSubtitle", { host: entry.serverName });

  return (
    <div
      className={cn(settingsStyles.row, !isLast && settingsStyles.rowBorder)}
      data-testid={isOutbound ? "tunnels-row-outbound" : "tunnels-row-inbound"}
    >
      <div className={ROW_CONTENT}>
        {isOutbound ? (
          <div className="flex flex-row flex-wrap items-center gap-2">
            <div className="rounded-[4px] bg-muted px-2 py-0.5">
              <span
                data-testid="tunnels-row-local-port"
                className="block truncate text-xs leading-[normal] text-foreground"
              >
                {localEndpoint}
              </span>
            </div>
            <ArrowRight size={13} className="shrink-0 text-muted-foreground" />
            <div className="rounded-[4px] bg-muted px-2 py-0.5">
              <span className="block truncate text-xs leading-[normal] text-foreground">
                {remoteEndpoint}
              </span>
            </div>
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
              leftIcon={Pencil}
              onPress={handleEdit}
              disabled={!isConnected}
              testID="tunnels-row-edit"
            >
              {isZh ? "改端口" : "Edit"}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onPress={remove}
              disabled={!isConnected}
              accessibilityLabel={isZh ? "删除此端口转发" : "Remove port forward"}
              testID="tunnels-row-delete"
            >
              {TRASH_ICON}
            </Button>
          </>
        ) : undefined}
      </div>
    </div>
  );
}

function AllowlistSection({ serverId }: { serverId: string }): ReactElement | null {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [draft, setDraft] = useState("");
  const [resetSeq, setResetSeq] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allowedPorts = useMemo(() => config?.tunnel?.allowedPorts ?? [], [config]);

  const addPortAsync = useCallback(async () => {
    const parsedPorts = parsePortList(draft);
    if (!parsedPorts) {
      setError(t("tunnels.allowlist.invalidPort"));
      return;
    }
    const merged = [...allowedPorts];
    for (const p of parsedPorts) {
      if (!merged.includes(p)) {
        merged.push(p);
      }
    }
    merged.sort((a, b) => a - b);
    if (merged.length === allowedPorts.length) {
      setDraft("");
      setResetSeq((n) => n + 1);
      setError(null);
      return;
    }
    setSaving(true);
    try {
      await patchConfig({ tunnel: { allowedPorts: merged } });
      setDraft("");
      setResetSeq((n) => n + 1);
      setError(null);
    } catch {
      setError(t("tunnels.allowlist.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [draft, allowedPorts, patchConfig, t]);

  const addPort = useCallback(() => {
    void addPortAsync();
  }, [addPortAsync]);

  const removePort = useCallback(
    async (port: number) => {
      setSaving(true);
      try {
        await patchConfig({ tunnel: { allowedPorts: allowedPorts.filter((p) => p !== port) } });
      } catch {
        setError(t("tunnels.allowlist.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [allowedPorts, patchConfig, t],
  );
  const makeRemovePortHandler = useCallback(
    (port: number) => () => {
      void removePort(port);
    },
    [removePort],
  );

  if (!config) {
    return null;
  }

  return (
    <SettingsSection title={t("tunnels.allowlist.title")}>
      <div className={settingsStyles.card}>
        <div className={cn(settingsStyles.row, "gap-2")}>
          <FormTextInput
            size="sm"
            className="flex-1"
            initialValue={draft}
            resetKey={resetSeq}
            onChangeText={setDraft}
            onSubmitEditing={addPort}
            placeholder={
              isZh ? "输入端口号（可填多个，如 3425, 3430）" : "Enter port(s), e.g. 3425, 3430"
            }
            keyboardType="number-pad"
            testID="tunnels-allowlist-input"
          />
          <Button
            variant="secondary"
            size="sm"
            onPress={addPort}
            disabled={saving || draft.trim().length === 0}
          >
            {saving ? t("tunnels.allowlist.saving") : t("tunnels.allowlist.add")}
          </Button>
        </div>
        {allowedPorts.length === 0 ? (
          <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>
            <span className="text-xs leading-[normal] text-muted-foreground">
              {t("tunnels.allowlist.empty")}
            </span>
          </div>
        ) : (
          allowedPorts.map((port) => (
            <div key={port} className={cn(settingsStyles.row, settingsStyles.rowBorder)}>
              <div className="flex flex-1 flex-row items-center gap-3">
                <div className="rounded-[4px] bg-muted px-2 py-0.5">
                  <span className="text-xs leading-[normal] text-foreground">127.0.0.1:{port}</span>
                </div>
                <span className="text-xs leading-[normal] text-muted-foreground">
                  {t("tunnels.allowlist.port", { port })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onPress={makeRemovePortHandler(port)}
                disabled={saving}
              >
                {TRASH_ICON}
              </Button>
            </div>
          ))
        )}
      </div>
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
  forwards: Array<{ remotePort: number; localPort?: number }>;
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

function AddTunnelSheet({
  serverId,
  existingPeerIds,
  onClose,
  onCreated,
}: {
  serverId: string;
  existingPeerIds: Set<string>;
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const client = useHostRuntimeClient(serverId);
  const hosts = useHosts();
  const peerTargets = useMemo(() => resolveTunnelPeerTargets(hosts), [hosts]);
  const selectableTargets = useMemo(
    () => peerTargets.filter((target) => target.serverId !== serverId),
    [peerTargets, serverId],
  );

  const [selectedPeerId, setSelectedPeerId] = useState<string>(
    selectableTargets[0]?.serverId ?? PASTE_OFFER_OPTION_ID,
  );
  const [offerUrl, setOfferUrl] = useState("");
  const [password, setPassword] = useState(selectableTargets[0]?.password ?? "");
  const [remotePort, setRemotePort] = useState("");
  const [localPort, setLocalPort] = useState("");
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
    if (!client) {
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

    const forwards = remotePorts.map((rp, idx) => {
      let lp = rp;
      if (parsedLocalPorts !== undefined) {
        lp =
          parsedLocalPorts.length === 1 && remotePorts.length === 1
            ? parsedLocalPorts[0]
            : parsedLocalPorts[idx];
      }
      const item: { remotePort: number; localPort?: number } = { remotePort: rp };
      if (lp) {
        item.localPort = lp;
      }
      return item;
    });

    setSubmitting(true);
    try {
      const response =
        selection.kind === "host"
          ? await client.createTunnel({
              peerId: selection.target.serverId,
              peerHostname: selection.target.label,
              url: selection.target.url,
              ...(password ? { password } : {}),
              ...(selection.target.daemonPublicKeyB64
                ? { daemonPublicKeyB64: selection.target.daemonPublicKeyB64 }
                : {}),
              forwards,
            })
          : await createTunnelFromOffer({
              client,
              offerUrl: selection.url,
              password,
              forwards,
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
  }, [client, localPort, password, onCreated, passwordOptional, remotePort, resolveSelection, t]);

  const submit = useCallback(() => {
    void submitAsync();
  }, [submitAsync]);

  const header = useMemo<SheetHeader>(() => ({ title: t("tunnels.addForm.title") }), [t]);

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} testID="tunnels-add-sheet">
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
        <Field label={t("tunnels.addForm.offerLabel")}>
          <FormTextInput
            initialValue={offerUrl}
            onChangeText={setOfferUrl}
            placeholder={t("tunnels.addForm.offerPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            testID="tunnels-add-offer-input"
          />
        </Field>
      ) : undefined}
      {!passwordOptional ? (
        <Field label={t("tunnels.addForm.passwordLabel")}>
          <FormTextInput
            initialValue={password}
            resetKey={selectedPeerId}
            onChangeText={setPassword}
            placeholder={t("tunnels.addForm.passwordPlaceholder")}
            type="password"
            testID="tunnels-add-password-input"
          />
        </Field>
      ) : undefined}
      <Field
        label={
          isZh ? "远端端口（支持填多个，如 3425, 3430）" : t("tunnels.addForm.remotePortLabel")
        }
      >
        <FormTextInput
          initialValue={remotePort}
          onChangeText={setRemotePort}
          placeholder="3425, 3430"
          keyboardType="number-pad"
          testID="tunnels-add-port-input"
        />
      </Field>
      <Field
        label={
          isZh
            ? "本地固定端口（可选，不填默认与远端端口相同）"
            : "Local port (optional, defaults to same as remote port)"
        }
      >
        <FormTextInput
          initialValue={localPort}
          onChangeText={setLocalPort}
          onSubmitEditing={submit}
          placeholder={remotePort.trim() || "3425, 3430"}
          keyboardType="number-pad"
          testID="tunnels-add-local-port-input"
        />
      </Field>
      {error ? (
        <span className="mt-2 text-xs leading-[normal] text-red-300">{error}</span>
      ) : undefined}
      <span className="mt-2 text-xs leading-[normal] text-muted-foreground">
        {t("tunnels.addForm.hint")}
      </span>
      <div className={SHEET_ACTIONS}>
        <Button variant="secondary" onPress={onClose} disabled={submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button variant="default" onPress={submit} disabled={submitting}>
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
  const [remotePort, setRemotePort] = useState(String(entry.remotePort));
  const [localPort, setLocalPort] = useState(
    entry.localPort != null ? String(entry.localPort) : String(entry.remotePort),
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
      const response = await client.createTunnel({
        peerId,
        ...(entry.peerHostname ? { peerHostname: entry.peerHostname } : {}),
        replaceRemotePort: entry.remotePort,
        forwards: [{ remotePort: rp, localPort: lp }],
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
  }, [client, entry.peerHostname, entry.remotePort, localPort, onSaved, peerId, remotePort, t]);

  const save = useCallback(() => {
    void saveAsync();
  }, [saveAsync]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: isZh ? `修改端口转发 · ${peerLabel}` : `Edit port forward · ${peerLabel}`,
    }),
    [isZh, peerLabel],
  );

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} testID="tunnels-edit-sheet">
      <Field label={isZh ? "本地监听端口 (127.0.0.1)" : "Local port (127.0.0.1)"}>
        <FormTextInput
          initialValue={localPort}
          onChangeText={setLocalPort}
          onSubmitEditing={save}
          placeholder="3425"
          keyboardType="number-pad"
          testID="tunnels-edit-local-port-input"
        />
      </Field>
      <Field label={isZh ? `远端目标端口 (${peerLabel})` : `Remote port (${peerLabel})`}>
        <FormTextInput
          initialValue={remotePort}
          onChangeText={setRemotePort}
          onSubmitEditing={save}
          placeholder="3425"
          keyboardType="number-pad"
          testID="tunnels-edit-remote-port-input"
        />
      </Field>
      {error ? (
        <span className="mt-2 text-xs leading-[normal] text-red-300">{error}</span>
      ) : undefined}
      <div className={SHEET_ACTIONS}>
        <Button variant="secondary" onPress={onClose} disabled={submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button variant="default" onPress={save} disabled={submitting} testID="tunnels-edit-save">
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
