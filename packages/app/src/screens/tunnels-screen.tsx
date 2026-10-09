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
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { parsePairingOfferUrl, type PairOfferErrorKey } from "@/utils/pair-offer";
import { buildRelayWebSocketUrl } from "@bytetrue/protocol/daemon-endpoints";
import { useTunnels, type AggregatedTunnelEntry, type TunnelLoadState } from "@/hooks/use-tunnels";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

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
  const [formState, setFormState] = useState<FormState>({ mode: "closed" });

  const entries = loadState.status === "loaded" ? loadState.data : [];

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
        {localDaemonServerId ? (
          <View style={styles.toolbar}>
            <AddTunnelButton onPress={openCreateForm} />
          </View>
        ) : undefined}
        <TunnelsListBody
          localDaemonServerId={localDaemonServerId}
          loadState={loadState}
          entries={entries}
          onRemoved={refetch}
        />
        {localDaemonServerId ? <AllowlistSection serverId={localDaemonServerId} /> : undefined}
      </ScrollView>
      {formState.mode === "create" && localDaemonServerId ? (
        <AddTunnelSheet
          serverId={localDaemonServerId}
          onClose={closeCreateForm}
          onCreated={refetch}
        />
      ) : undefined}
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
    <Button variant="secondary" size="sm" leftIcon={Plus} onPress={onPress} testID="tunnels-add">
      {t("tunnels.add")}
    </Button>
  );
}

function TunnelsListBody({
  localDaemonServerId,
  loadState,
  entries,
  onRemoved,
}: {
  localDaemonServerId: string | null;
  loadState: TunnelLoadState;
  entries: AggregatedTunnelEntry[];
  onRemoved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  if (!localDaemonServerId) {
    return <Text style={styles.hint}>{t("tunnels.noLocalDaemon")}</Text>;
  }
  if (loadState.status !== "loaded") {
    return (
      <View style={styles.loadingRow}>
        <ThemedLoadingSpinner size={14} />
        <Text style={styles.hint}>{t("common.states.loading")}</Text>
      </View>
    );
  }
  if (entries.length === 0) {
    return <Text style={styles.hint}>{t("tunnels.empty")}</Text>;
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
          <Text style={styles.allowlistEmpty}>{t("tunnels.allowlist.empty")}</Text>
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
        <View style={[settingsStyles.row, styles.allowlistInputRow]}>
          <AdaptiveTextInput
            style={styles.portInput}
            onChangeText={setDraft}
            placeholder={t("tunnels.allowlist.portPlaceholder")}
            keyboardType="number-pad"
            variant="default"
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
  const [offerUrl, setOfferUrl] = useState("");
  const [password, setPassword] = useState("");
  const [remotePort, setRemotePort] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitAsync = useCallback(async () => {
    if (!client) {
      setError(t("workspace.terminal.hostDisconnected"));
      return;
    }
    const parsed = parsePairingOfferUrl(offerUrl);
    if (!parsed.ok) {
      setError(t("pairing.link.errors." + (parsed.errorKey as PairOfferErrorKey)));
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
    setSubmitting(true);
    try {
      const offer = parsed.offer;
      const url = buildRelayWebSocketUrl({
        endpoint: offer.relay.endpoint,
        useTls: offer.relay.useTls ?? true,
        serverId: offer.serverId,
        role: "client",
      });
      const response = await client.createTunnel({
        peerId: offer.serverId,
        peerHostname: offer.hostname,
        url,
        password,
        daemonPublicKeyB64: offer.daemonPublicKeyB64,
        forwards: [{ remotePort: port }],
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
  }, [client, offerUrl, password, remotePort, onCreated, t]);

  const submit = useCallback(() => {
    void submitAsync();
  }, [submitAsync]);

  const header = useMemo<SheetHeader>(() => ({ title: t("tunnels.addForm.title") }), [t]);

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} testID="tunnels-add-sheet">
      <Text style={styles.fieldLabel}>{t("tunnels.addForm.offerLabel")}</Text>
      <AdaptiveTextInput
        style={styles.textInput}
        onChangeText={setOfferUrl}
        placeholder={t("tunnels.addForm.offerPlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        variant="default"
      />
      <Text style={styles.fieldLabel}>{t("tunnels.addForm.passwordLabel")}</Text>
      <AdaptiveTextInput
        style={styles.textInput}
        onChangeText={setPassword}
        placeholder={t("tunnels.addForm.passwordPlaceholder")}
        secureTextEntry
        variant="default"
      />
      <Text style={styles.fieldLabel}>{t("tunnels.addForm.remotePortLabel")}</Text>
      <AdaptiveTextInput
        style={styles.textInput}
        onChangeText={setRemotePort}
        placeholder="3000"
        keyboardType="number-pad"
        variant="default"
      />
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
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      padding: theme.spacing[2],
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
    allowlistEmpty: {
      ...settingsStyles.row,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    allowlistInputRow: {
      gap: theme.spacing[2],
    },
    portInput: {
      flex: 1,
    },
    fieldLabel: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
      marginBottom: theme.spacing[1],
    },
    textInput: {
      marginBottom: theme.spacing[3],
    },
    sheetActions: {
      flexDirection: "row",
      gap: theme.spacing[2],
      marginTop: theme.spacing[4],
    },
  };
});
