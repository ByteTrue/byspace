import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowRightLeft, Pencil, Plus, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
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
import type { MutableDaemonConfig } from "@bytetrue/protocol/messages";

type FormState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; entry: AggregatedTunnelEntry };

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArrowRight = withUnistyles(ArrowRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedTrashIcon = withUnistyles(Trash2, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

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
    return <View style={styles.container} />;
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
    <View style={styles.container}>
      <MenuHeader title={t("tunnels.title")} />
      <ScrollView contentContainerStyle={styles.content}>
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
      </ScrollView>
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
    </View>
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
    return <Text style={styles.hint}>{t("tunnels.noLocalDaemon")}</Text>;
  }
  if (!props.localDaemonSupportsTunnels) {
    return <Text style={styles.hint}>{t("tunnels.hostTooOld")}</Text>;
  }
  if (props.configLoading && !props.config) {
    return (
      <View style={styles.loadingRow}>
        <ThemedLoadingSpinner size={14} />
        <Text style={styles.hint}>{t("common.states.loading")}</Text>
      </View>
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
      <View style={styles.sectionHeaderActions}>
        <StatusBadge label={t("tunnels.experimental")} variant="muted" />
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
      </View>
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
    <View style={styles.enabledBody}>
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
    </View>
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
    <View style={settingsStyles.card} testID="tunnels-enable-card">
      <View style={[settingsStyles.row, styles.enableCardRow]}>
        <View style={styles.rowContent}>
          <Text style={styles.sectionLabel}>{t("tunnels.enable.title")}</Text>
          <Text style={styles.hint}>{t("tunnels.enable.description")}</Text>
          {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
        </View>
        <Button
          variant="secondary"
          size="sm"
          onPress={enable}
          disabled={enabling}
          testID="tunnels-enable"
        >
          {enabling ? t("tunnels.enable.enabling") : t("tunnels.enable.action")}
        </Button>
      </View>
    </View>
  );
}

function resolveBadgeVariant(state: AggregatedTunnelEntry["state"]): "success" | "error" | "muted" {
  if (state === "connected") return "success";
  if (state === "error") return "error";
  return "muted";
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
    return <Text style={styles.hint}>{t("tunnels.noLocalDaemon")}</Text>;
  }
  if (loadState.status !== "loaded") {
    return (
      <View style={settingsStyles.card}>
        <View style={styles.loadingRow}>
          <ThemedLoadingSpinner size={14} />
          <Text style={styles.hint}>{t("common.states.loading")}</Text>
        </View>
      </View>
    );
  }
  if (entries.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={styles.emptyState}>
          <ArrowRightLeft size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
          <View style={styles.emptyTextStack}>
            <Text style={styles.emptyTitle}>{t("tunnels.empty")}</Text>
            <Text style={styles.emptyDescription}>{t("tunnels.emptyDescription")}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={Plus}
            onPress={onAddTunnel}
            testID="tunnels-empty-add"
          >
            {t("tunnels.add")}
          </Button>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {entries.map((entry, index) => (
        <TunnelRow
          key={entry.serverId + ":" + entry.tunnelId}
          entry={entry}
          isLast={index === entries.length - 1}
          onEdit={onEditTunnel}
          onRemoved={onRemoved}
        />
      ))}
    </View>
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
  const badgeVariant = isPaused ? "muted" : resolveBadgeVariant(entry.state);

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
    <View
      style={[settingsStyles.row, isLast ? undefined : settingsStyles.rowBorder]}
      testID={isOutbound ? "tunnels-row-outbound" : "tunnels-row-inbound"}
    >
      <View style={styles.rowContent}>
        {isOutbound ? (
          <View style={styles.mappingLine}>
            <View style={styles.endpointPill}>
              <Text testID="tunnels-row-local-port" style={styles.endpointMono} numberOfLines={1}>
                {localEndpoint}
              </Text>
            </View>
            <ThemedArrowRight size={13} />
            <View style={styles.endpointPill}>
              <Text style={styles.endpointMono} numberOfLines={1}>
                {remoteEndpoint}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {t("tunnels.inboundFrom", { port: entry.remotePort })}
            </Text>
          </View>
        )}
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
        {entry.lastError ? (
          <Text style={styles.rowError} numberOfLines={2}>
            {entry.lastError}
          </Text>
        ) : undefined}
      </View>
      <View style={styles.rowTrailing}>
        <StatusBadge label={stateLabel} variant={badgeVariant} />
        {isOutbound ? (
          <>
            <Switch
              value={!isPaused}
              onValueChange={handleToggleEnabled}
              disabled={!isConnected}
              accessibilityLabel={isZh ? "启用或暂停此端口转发" : "Enable or pause port forward"}
              testID="tunnels-row-toggle"
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
              <ThemedTrashIcon size={14} />
            </Button>
          </>
        ) : undefined}
      </View>
    </View>
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
      <View style={settingsStyles.card}>
        <View style={[settingsStyles.row, styles.allowlistInputRow]}>
          <FormTextInput
            size="sm"
            style={styles.portInput}
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
        </View>
        {allowedPorts.length === 0 ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <Text style={styles.allowlistEmptyText}>{t("tunnels.allowlist.empty")}</Text>
          </View>
        ) : (
          allowedPorts.map((port) => (
            <View key={port} style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={styles.allowlistPortRow}>
                <View style={styles.endpointPill}>
                  <Text style={styles.endpointMono}>127.0.0.1:{port}</Text>
                </View>
                <Text style={styles.rowSubtitle}>{t("tunnels.allowlist.port", { port })}</Text>
              </View>
              <Button
                variant="ghost"
                size="xs"
                onPress={makeRemovePortHandler(port)}
                disabled={saving}
              >
                <ThemedTrashIcon size={14} />
              </Button>
            </View>
          ))
        )}
      </View>
      {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
      <Text style={styles.hint}>{t("tunnels.allowlist.hint")}</Text>
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
            secureTextEntry
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
      {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
      <Text style={styles.hint}>{t("tunnels.addForm.hint")}</Text>
      <View style={styles.sheetActions}>
        <Button variant="secondary" onPress={onClose} disabled={submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button variant="default" onPress={submit} disabled={submitting}>
          {submitting ? t("tunnels.addForm.submitting") : t("tunnels.add")}
        </Button>
      </View>
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
      {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
      <View style={styles.sheetActions}>
        <Button variant="secondary" onPress={onClose} disabled={submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button variant="default" onPress={save} disabled={submitting} testID="tunnels-edit-save">
          {resolveEditSaveButtonLabel(submitting, isZh, t)}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => {
  return {
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: theme.spacing[4],
      gap: theme.spacing[4],
      maxWidth: 720,
      width: "100%",
      alignSelf: "center",
    },
    enabledBody: {
      gap: theme.spacing[4],
    },
    sectionHeaderActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    enableCardRow: {
      gap: theme.spacing[3],
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      padding: theme.spacing[4],
    },
    emptyState: {
      alignItems: "center",
      gap: theme.spacing[4],
      paddingVertical: theme.spacing[6],
      paddingHorizontal: theme.spacing[4],
    },
    emptyTextStack: {
      alignItems: "center",
      gap: theme.spacing[1],
    },
    emptyTitle: {
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
    },
    emptyDescription: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      textAlign: "center",
    },
    emptyIcon: {
      width: theme.iconSize.lg,
      color: theme.colors.foregroundMuted,
    },
    hint: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      marginTop: theme.spacing[2],
    },
    sectionLabel: {
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
      marginBottom: theme.spacing[2],
    },
    rowContent: {
      flex: 1,
      gap: theme.spacing[1],
    },
    rowTitleLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    mappingLine: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[2],
    },
    endpointPill: {
      paddingVertical: 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.surface2,
    },
    endpointMono: {
      fontSize: theme.fontSize.sm,
      fontFamily: theme.fontFamily.mono,
      color: theme.colors.foreground,
    },
    rowTitle: {
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
    },
    rowSubtitle: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    rowError: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.palette.red[300],
    },
    inlineError: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.palette.red[300],
      marginTop: theme.spacing[2],
    },
    rowTrailing: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    allowlistEmptyText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    allowlistInputRow: {
      gap: theme.spacing[2],
    },
    allowlistPortRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      flex: 1,
    },
    portInput: {
      flex: 1,
    },
    sheetActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: theme.spacing[2],
      marginTop: theme.spacing[2],
    },
  };
});
