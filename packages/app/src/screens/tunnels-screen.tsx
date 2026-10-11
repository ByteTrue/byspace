import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft, Plus, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { parsePairingOfferUrl, type PairOfferErrorKey } from "@/utils/pair-offer";
import { buildRelayWebSocketUrl } from "@bytetrue/protocol/daemon-endpoints";
import { useTunnels, type AggregatedTunnelEntry, type TunnelLoadState } from "@/hooks/use-tunnels";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHosts, useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SelectField, type SelectFieldDisplay } from "@/components/ui/select-field";
import { resolveTunnelPeerTargets, type TunnelPeerTarget } from "@/tunnels/tunnel-peer-targets";
import { settingsStyles } from "@/styles/settings";
import type { MutableDaemonConfig } from "@bytetrue/protocol/messages";

type FormState = { mode: "closed" } | { mode: "create" };

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function outboundPeerId(entry: AggregatedTunnelEntry): string {
  return entry.tunnelId.split(":")[0];
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
  const [formState, setFormState] = useState<FormState>({ mode: "closed" });

  const entries = loadState.status === "loaded" ? loadState.data : [];
  const tunnelsEnabled = config?.tunnel?.enabled === true;

  const openCreateForm = useCallback(() => {
    setFormState({ mode: "create" });
  }, []);
  const closeCreateForm = useCallback(() => {
    setFormState({ mode: "closed" });
  }, []);

  return (
    <View style={styles.container}>
      <MenuHeader title={t("tunnels.title")} />
      <ScrollView contentContainerStyle={styles.content}>
        <TunnelsScreenBody
          localDaemonServerId={localDaemonServerId}
          config={config}
          configLoading={configLoading}
          tunnelsEnabled={tunnelsEnabled}
          entries={entries}
          loadState={loadState}
          onAddTunnel={openCreateForm}
          onRemoved={refetch}
        />
      </ScrollView>
      {formState.mode === "create" && localDaemonServerId && tunnelsEnabled ? (
        <AddTunnelSheet
          serverId={localDaemonServerId}
          onClose={closeCreateForm}
          onCreated={refetch}
        />
      ) : undefined}
    </View>
  );
}

function TunnelsScreenBody(props: {
  localDaemonServerId: string | null;
  config: MutableDaemonConfig | null;
  configLoading: boolean;
  tunnelsEnabled: boolean;
  entries: AggregatedTunnelEntry[];
  loadState: TunnelLoadState;
  onAddTunnel: () => void;
  onRemoved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  if (!props.localDaemonServerId) {
    return <Text style={styles.hint}>{t("tunnels.noLocalDaemon")}</Text>;
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
      onRemoved={props.onRemoved}
    />
  );
}

function TunnelsEnabledBody({
  entries,
  loadState,
  localDaemonServerId,
  onAddTunnel,
  onRemoved,
}: {
  entries: AggregatedTunnelEntry[];
  loadState: TunnelLoadState;
  localDaemonServerId: string;
  onAddTunnel: () => void;
  onRemoved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.enabledBody}>
      <View style={styles.toolbarRow}>
        <StatusBadge label={t("tunnels.experimental")} variant="muted" />
        <AddTunnelButton onPress={onAddTunnel} />
      </View>
      <TunnelsListBody
        localDaemonServerId={localDaemonServerId}
        loadState={loadState}
        entries={entries}
        onAddTunnel={onAddTunnel}
        onRemoved={onRemoved}
      />
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
  onRemoved,
}: {
  localDaemonServerId: string | null;
  loadState: TunnelLoadState;
  entries: AggregatedTunnelEntry[];
  onAddTunnel: () => void;
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
          onRemoved={onRemoved}
        />
      ))}
    </View>
  );
}

function TunnelRow({
  entry,
  isLast,
  onRemoved,
}: {
  entry: AggregatedTunnelEntry;
  isLast: boolean;
  onRemoved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(entry.serverId);
  const isConnected = useHostRuntimeIsConnected(entry.serverId);

  const stateLabel = useMemo(() => {
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
  }, [entry.state, t]);

  const isOutbound = entry.direction === "outbound";
  const badgeVariant = resolveBadgeVariant(entry.state);
  const remove = useCallback(() => {
    if (!client || !isConnected || !isOutbound) return;
    void client
      .removeTunnel(outboundPeerId(entry))
      .then(() => onRemoved())
      .catch(() => undefined);
  }, [client, isConnected, isOutbound, entry, onRemoved]);

  const title = isOutbound
    ? (entry.peerHostname ?? outboundPeerId(entry)) + " → :" + entry.remotePort
    : t("tunnels.inboundFrom", { port: entry.remotePort });

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
        <View style={styles.rowTitleLine}>
          {isOutbound ? <ArrowRightLeft size={14} /> : undefined}
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
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
        {isOutbound ? (
          <Text testID="tunnels-row-local-port" style={styles.localPortText} numberOfLines={1}>
            {entry.localPort == null ? "—" : ":" + entry.localPort}
          </Text>
        ) : undefined}
        <StatusBadge label={stateLabel} variant={badgeVariant} />
        {isOutbound ? (
          <Button variant="ghost" size="xs" onPress={remove} disabled={!isConnected}>
            <Trash2 size={14} />
          </Button>
        ) : undefined}
      </View>
    </View>
  );
}

function AllowlistSection({ serverId }: { serverId: string }): ReactElement | null {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allowedPorts = useMemo(() => config?.tunnel?.allowedPorts ?? [], [config]);

  const addPort = useCallback(async () => {
    const port = Number.parseInt(draft.trim(), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t("tunnels.allowlist.invalidPort"));
      return;
    }
    if (allowedPorts.includes(port)) {
      setDraft("");
      setError(null);
      return;
    }
    setSaving(true);
    try {
      await patchConfig({ tunnel: { allowedPorts: [...allowedPorts, port] } });
      setDraft("");
      setError(null);
    } catch {
      setError(t("tunnels.allowlist.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [draft, allowedPorts, patchConfig, t]);

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
    <View style={styles.allowlistSection}>
      <Text style={styles.sectionLabel}>{t("tunnels.allowlist.title")}</Text>
      <View style={settingsStyles.card}>
        {allowedPorts.length === 0 ? (
          <Text style={[settingsStyles.row, styles.allowlistEmptyText]}>
            {t("tunnels.allowlist.empty")}
          </Text>
        ) : (
          allowedPorts.map((port, index) => (
            <View
              key={port}
              style={[
                settingsStyles.row,
                index === allowedPorts.length - 1 ? undefined : settingsStyles.rowBorder,
              ]}
            >
              <Text style={styles.rowTitle}>{t("tunnels.allowlist.port", { port })}</Text>
              <Button
                variant="ghost"
                size="xs"
                onPress={makeRemovePortHandler(port)}
                disabled={saving}
              >
                <Trash2 size={14} />
              </Button>
            </View>
          ))
        )}
        <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.allowlistInputRow]}>
          <FormTextInput
            size="sm"
            style={styles.portInput}
            onChangeText={setDraft}
            placeholder={t("tunnels.allowlist.portPlaceholder")}
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
        {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
      </View>
      <Text style={styles.hint}>{t("tunnels.allowlist.hint")}</Text>
    </View>
  );
}

/** Sentinel id for the "paste a pairing link instead" option in the peer picker. */
const PASTE_OFFER_OPTION_ID = "paste-offer";

/**
 * Create a tunnel from a pasted pairing link. The registry path (a paired host)
 * is the common case; this covers a peer that has not been added as a host yet.
 */
async function createTunnelFromOffer(input: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  offerUrl: string;
  password: string;
  remotePort: number;
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
    password: input.password,
    daemonPublicKeyB64: offer.daemonPublicKeyB64,
    forwards: [{ remotePort: input.remotePort }],
  });
}

/**
 * The target a submit will dial: either a paired host from the registry, or the
 * daemon described by a pasted pairing link.
 */
type TunnelPeerSelection =
  | { kind: "host"; target: TunnelPeerTarget }
  | { kind: "offer"; url: string };

function AddTunnelSheet({
  serverId,
  onClose,
  onCreated,
}: {
  serverId: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const hosts = useHosts();
  const peerTargets = useMemo(() => resolveTunnelPeerTargets(hosts), [hosts]);
  // The daemon we are configuring is the tunnel's local end, so it can never be
  // the peer: a host is only listed once the registry knows about another one.
  const selectableTargets = useMemo(
    () => peerTargets.filter((target) => target.serverId !== serverId),
    [peerTargets, serverId],
  );

  const [selectedPeerId, setSelectedPeerId] = useState<string>(PASTE_OFFER_OPTION_ID);
  const [offerUrl, setOfferUrl] = useState("");
  const [password, setPassword] = useState("");
  const [remotePort, setRemotePort] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedTarget = useMemo(
    () => selectableTargets.find((target) => target.serverId === selectedPeerId) ?? null,
    [selectableTargets, selectedPeerId],
  );
  const isPastingOffer = selectedTarget === null;

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
      // A host that stores its password (direct TCP) fills the field so the user
      // does not retype a credential the registry already holds.
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
    const port = Number.parseInt(remotePort.trim(), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t("tunnels.addForm.invalidPort"));
      return;
    }
    if (!password) {
      setError(t("tunnels.addForm.passwordRequired"));
      return;
    }
    const selection = resolveSelection();
    if (!selection) return;

    setSubmitting(true);
    try {
      const response =
        selection.kind === "host"
          ? await client.createTunnel({
              peerId: selection.target.serverId,
              peerHostname: selection.target.label,
              url: selection.target.url,
              password,
              ...(selection.target.daemonPublicKeyB64
                ? { daemonPublicKeyB64: selection.target.daemonPublicKeyB64 }
                : {}),
              forwards: [{ remotePort: port }],
            })
          : await createTunnelFromOffer({
              client,
              offerUrl: selection.url,
              password,
              remotePort: port,
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
  }, [client, password, remotePort, onCreated, resolveSelection, t]);

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
            onChangeText={setOfferUrl}
            placeholder={t("tunnels.addForm.offerPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            testID="tunnels-add-offer-input"
          />
        </Field>
      ) : undefined}
      <Field label={t("tunnels.addForm.passwordLabel")}>
        <FormTextInput
          onChangeText={setPassword}
          placeholder={t("tunnels.addForm.passwordPlaceholder")}
          secureTextEntry
          testID="tunnels-add-password-input"
        />
      </Field>
      <Field label={t("tunnels.addForm.remotePortLabel")}>
        <FormTextInput
          onChangeText={setRemotePort}
          placeholder="3000"
          keyboardType="number-pad"
          testID="tunnels-add-port-input"
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
    toolbar: {
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    enabledBody: {
      gap: theme.spacing[4],
    },
    toolbarRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
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
    localPortText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    allowlistSection: {
      marginTop: theme.spacing[2],
      gap: theme.spacing[2],
    },
    allowlistEmptyText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    allowlistInputRow: {
      gap: theme.spacing[3],
    },
    portInput: {
      flex: 1,
      minWidth: 0,
    },
    sheetActions: {
      flexDirection: "row",
      gap: theme.spacing[2],
      marginTop: theme.spacing[4],
    },
  };
});
