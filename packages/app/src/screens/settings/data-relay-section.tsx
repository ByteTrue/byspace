import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Check, Copy, Radio, RotateCw, Server } from "lucide-react-native";
import type { TFunction } from "i18next";
import type {
  MutableDataRelayConfig,
  ServerInfoStatusPayload,
} from "@bytetrue/byspace-protocol/messages";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useTranslation } from "react-i18next";

const FLEX_ONE_STYLE = { flex: 1 } as const;

export function generateRandomDataRelayToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type RelayMode = "host" | "client";

function DataRelayConfigSheet({
  visible,
  host,
  isSaving,
  onClose,
  onSave,
  onDisable,
  initialListen,
  initialEndpoint,
  initialPublicEndpoint,
  initialUseTls,
  initialAccessToken,
  isConfigured,
}: {
  visible: boolean;
  host: HostProfile;
  isSaving: boolean;
  onClose: () => void;
  onSave: (config: {
    listen: string | null;
    endpoint: string | null;
    publicEndpoint: string | null;
    useTls: boolean;
    accessToken: string | null;
  }) => Promise<void>;
  onDisable: () => Promise<void>;
  initialListen?: string | null;
  initialEndpoint?: string | null;
  initialPublicEndpoint?: string | null;
  initialUseTls?: boolean;
  initialAccessToken?: string | null;
  isConfigured: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const isInitiallyHost = Boolean(initialListen);
  const [mode, setMode] = useState<RelayMode>(isInitiallyHost ? "host" : "client");

  // Host mode fields
  const [listen, setListen] = useState(initialListen || "127.0.0.1:8788");
  const [publicEndpoint, setPublicEndpoint] = useState(initialPublicEndpoint || "");
  const [connectLocally, setConnectLocally] = useState(true);

  // Client mode fields
  const [endpoint, setEndpoint] = useState(initialEndpoint || "");
  const [useTls, setUseTls] = useState(initialUseTls ?? true);

  // Shared token
  const [accessToken, setAccessToken] = useState(initialAccessToken || "");
  const [hasCopiedToken, setHasCopiedToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.dataRelay.modalTitle") }),
    [t],
  );

  const handleSetHostMode = useCallback(() => setMode("host"), []);
  const handleSetClientMode = useCallback(() => setMode("client"), []);
  const hostAccessibilityState = useMemo(() => ({ selected: mode === "host" }), [mode]);
  const clientAccessibilityState = useMemo(() => ({ selected: mode === "client" }), [mode]);

  const handleGenerateToken = useCallback(() => {
    const nextToken = generateRandomDataRelayToken();
    setAccessToken(nextToken);
    toast.show(t("settings.host.dataRelay.tokenGenerated"));
  }, [t, toast]);

  const handleCopyToken = useCallback(() => {
    if (!accessToken) return;
    void copyToClipboard(accessToken).then(() => {
      setHasCopiedToken(true);
      setTimeout(() => setHasCopiedToken(false), 2000);
      toast.show(t("settings.host.dataRelay.tokenCopied"));
      return undefined;
    });
  }, [accessToken, t, toast]);

  const handleSave = useCallback(async () => {
    const trimmedToken = accessToken.trim();
    if (!trimmedToken) {
      setError(t("settings.host.dataRelay.tokenRequired"));
      return;
    }

    if (mode === "host") {
      const trimmedListen = listen.trim();
      if (!trimmedListen) {
        setError(t("settings.host.dataRelay.listenRequired"));
        return;
      }
      const trimmedPublic = publicEndpoint.trim() || null;
      setError(null);
      try {
        await onSave({
          listen: trimmedListen,
          endpoint: connectLocally ? trimmedListen : trimmedPublic,
          publicEndpoint: trimmedPublic,
          useTls: !connectLocally,
          accessToken: trimmedToken,
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } else {
      const trimmedEndpoint = endpoint.trim();
      if (!trimmedEndpoint) {
        setError(t("settings.host.dataRelay.endpointRequired"));
        return;
      }
      setError(null);
      try {
        await onSave({
          listen: null,
          endpoint: trimmedEndpoint,
          publicEndpoint: null,
          useTls,
          accessToken: trimmedToken,
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [
    accessToken,
    connectLocally,
    endpoint,
    listen,
    mode,
    onClose,
    onSave,
    publicEndpoint,
    t,
    useTls,
  ]);

  const handleDisable = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("settings.host.dataRelay.disableConfirmTitle"),
      message: t("settings.host.dataRelay.disableConfirmMessage"),
      confirmLabel: t("settings.host.dataRelay.disable"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await onDisable();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [onClose, onDisable, t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={520}
      testID="data-relay-config-sheet"
    >
      <Text style={styles.helper}>
        {t("settings.host.dataRelay.modalDescription", { host: host.label })}
      </Text>

      {/* Mode Selector */}
      <View style={styles.modeTabs}>
        <Pressable
          style={[styles.modeTab, mode === "host" && styles.modeTabActive]}
          onPress={handleSetHostMode}
          accessibilityRole="tab"
          accessibilityState={hostAccessibilityState}
          testID="data-relay-mode-host"
        >
          <Server size={16} color={mode === "host" ? "#fff" : "#999"} />
          <Text style={[styles.modeTabText, mode === "host" && styles.modeTabTextActive]}>
            {t("settings.host.dataRelay.modeHost")}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeTab, mode === "client" && styles.modeTabActive]}
          onPress={handleSetClientMode}
          accessibilityRole="tab"
          accessibilityState={clientAccessibilityState}
          testID="data-relay-mode-client"
        >
          <Radio size={16} color={mode === "client" ? "#fff" : "#999"} />
          <Text style={[styles.modeTabText, mode === "client" && styles.modeTabTextActive]}>
            {t("settings.host.dataRelay.modeClient")}
          </Text>
        </Pressable>
      </View>

      {mode === "host" ? (
        <>
          <Text style={styles.modeHint}>{t("settings.host.dataRelay.modeHostHint")}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t("settings.host.dataRelay.listenLabel")}</Text>
            <AdaptiveTextInput
              initialValue={listen}
              value={listen}
              onChangeText={setListen}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSaving}
              placeholder="127.0.0.1:8788"
              testID="data-relay-listen-input"
            />
            <Text style={styles.fieldHint}>{t("settings.host.dataRelay.listenHint")}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t("settings.host.dataRelay.publicEndpointLabel")}</Text>
            <AdaptiveTextInput
              initialValue={publicEndpoint}
              value={publicEndpoint}
              onChangeText={setPublicEndpoint}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSaving}
              placeholder="relay.example.com:443"
              testID="data-relay-public-endpoint-input"
            />
            <Text style={styles.fieldHint}>{t("settings.host.dataRelay.publicEndpointHint")}</Text>
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchContent}>
              <Text style={styles.switchTitle}>
                {t("settings.host.dataRelay.connectLocallyTitle")}
              </Text>
              <Text style={styles.switchHint}>
                {t("settings.host.dataRelay.connectLocallyHint")}
              </Text>
            </View>
            <Switch
              value={connectLocally}
              onValueChange={setConnectLocally}
              disabled={isSaving}
              testID="data-relay-connect-locally-switch"
            />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.modeHint}>{t("settings.host.dataRelay.modeClientHint")}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t("settings.host.dataRelay.endpointLabel")}</Text>
            <AdaptiveTextInput
              initialValue={endpoint}
              value={endpoint}
              onChangeText={setEndpoint}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSaving}
              placeholder="relay.example.com:443"
              testID="data-relay-endpoint-input"
            />
            <Text style={styles.fieldHint}>{t("settings.host.dataRelay.endpointHint")}</Text>
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchContent}>
              <Text style={styles.switchTitle}>{t("settings.host.dataRelay.useTlsTitle")}</Text>
              <Text style={styles.switchHint}>{t("settings.host.dataRelay.useTlsHint")}</Text>
            </View>
            <Switch
              value={useTls}
              onValueChange={setUseTls}
              disabled={isSaving}
              testID="data-relay-use-tls-switch"
            />
          </View>
        </>
      )}

      {/* Access Token Field */}
      <View style={styles.field}>
        <View style={styles.labelWithAction}>
          <Text style={styles.label}>{t("settings.host.dataRelay.accessTokenLabel")}</Text>
          <Pressable onPress={handleGenerateToken} disabled={isSaving} style={styles.textButton}>
            <RotateCw size={12} color="#0a84ff" />
            <Text style={styles.textButtonLabel}>{t("settings.host.dataRelay.generateToken")}</Text>
          </Pressable>
        </View>
        <View style={styles.inputWithAddon}>
          <AdaptiveTextInput
            initialValue={accessToken}
            value={accessToken}
            onChangeText={setAccessToken}
            style={[styles.input, styles.inputFlex]}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={false}
            editable={!isSaving}
            placeholder={t("settings.host.dataRelay.accessTokenPlaceholder")}
            testID="data-relay-access-token-input"
          />
          {accessToken ? (
            <Pressable
              onPress={handleCopyToken}
              style={styles.addonButton}
              testID="data-relay-copy-token"
            >
              {hasCopiedToken ? (
                <Check size={16} color="#30d158" />
              ) : (
                <Copy size={16} color="#8e8e93" />
              )}
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.fieldHint}>{t("settings.host.dataRelay.accessTokenHint")}</Text>
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {isConfigured ? (
          <Button
            variant="destructive"
            onPress={handleDisable}
            disabled={isSaving}
            testID="data-relay-disable-button"
          >
            {t("settings.host.dataRelay.disable")}
          </Button>
        ) : null}
        <Button variant="secondary" style={FLEX_ONE_STYLE} onPress={onClose} disabled={isSaving}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          style={FLEX_ONE_STYLE}
          onPress={handleSave}
          disabled={isSaving}
          testID="data-relay-save-button"
        >
          {isSaving ? t("common.actions.saving") : t("settings.host.dataRelay.saveAndApply")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DataRelayResolvedState {
  isConfigured: boolean;
  isHosting: boolean;
  listen: string | null;
  endpoint: string | null;
  publicEndpoint: string | null;
  useTls: boolean;
  accessToken: string | null;
  endpointDisplay: string | null;
}

function resolveNullableField(a?: string | null, b?: string | null): string | null {
  return a !== undefined ? a : (b ?? null);
}

function resolveDataRelayState(
  config?: MutableDataRelayConfig,
  server?: ServerInfoStatusPayload["dataRelay"],
): DataRelayResolvedState {
  const listen = resolveNullableField(config?.listen, server?.listen);
  const endpoint = resolveNullableField(config?.endpoint, server?.endpoint);
  const publicEndpoint = resolveNullableField(config?.publicEndpoint, server?.publicEndpoint);
  const useTls = config?.useTls ?? server?.useTls ?? true;
  const accessToken = config?.accessToken ?? null;
  const isConfigured = server?.configured === true || Boolean(listen || endpoint);
  const isHosting = Boolean(listen);
  const endpointDisplay = endpoint ?? listen;
  return {
    isConfigured,
    isHosting,
    listen,
    endpoint,
    publicEndpoint,
    useTls,
    accessToken,
    endpointDisplay,
  };
}

function resolveDataRelayDisplayInfo(input: {
  isConfigured: boolean;
  isHosting: boolean;
  listen: string | null | undefined;
  endpoint: string | null | undefined;
  t: TFunction;
}) {
  const { isConfigured, isHosting, listen, endpoint, t } = input;
  if (!isConfigured) {
    return {
      badgeStyle: styles.badgeInactive,
      badgeText: t("settings.host.dataRelay.statusNotConfigured"),
      summary: t("settings.host.dataRelay.description"),
    };
  }
  if (isHosting) {
    return {
      badgeStyle: styles.badgeHosting,
      badgeText: t("settings.host.dataRelay.statusHosting"),
      summary: t("settings.host.dataRelay.summaryHosting", {
        listen: listen ?? "8788",
      }),
    };
  }
  return {
    badgeStyle: styles.badgeConnected,
    badgeText: t("settings.host.dataRelay.statusConnected"),
    summary: t("settings.host.dataRelay.summaryConnected", {
      endpoint: endpoint ?? "relay",
    }),
  };
}

export function DataRelaySection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const sessions = useSessionStore((storeState) => storeState.sessions);
  const serverInfo = sessions[host.serverId]?.serverInfo ?? null;
  const isSupported = serverInfo?.features?.remoteWebServices === true;
  const { config, isLoading, patchConfig } = useDaemonConfig(host.serverId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const state = useMemo(
    () => resolveDataRelayState(config?.dataRelay, serverInfo?.dataRelay),
    [config?.dataRelay, serverInfo?.dataRelay],
  );

  const handleOpenModal = useCallback(() => setIsModalOpen(true), []);
  const handleCloseModal = useCallback(() => setIsModalOpen(false), []);

  const handleSave = useCallback(
    async (nextConfig: {
      listen: string | null;
      endpoint: string | null;
      publicEndpoint: string | null;
      useTls: boolean;
      accessToken: string | null;
    }) => {
      setIsSaving(true);
      try {
        await patchConfig({
          dataRelay: nextConfig,
        });
        toast.show(t("settings.host.dataRelay.saveSuccess"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("common.errors.unableToSave"));
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig, t, toast],
  );

  const handleDisable = useCallback(async () => {
    setIsSaving(true);
    try {
      await patchConfig({
        dataRelay: {
          listen: null,
          endpoint: null,
          publicEndpoint: null,
          accessToken: null,
        },
      });
      toast.show(t("settings.host.dataRelay.disabledSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.errors.unableToSave"));
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [patchConfig, t, toast]);

  const { badgeStyle, badgeText, summary } = resolveDataRelayDisplayInfo({
    isConfigured: state.isConfigured,
    isHosting: state.isHosting,
    listen: state.listen,
    endpoint: state.endpointDisplay,
    t,
  });

  if (!isSupported) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.host.dataRelay.title")}>
      <View style={settingsStyles.card} testID="data-relay-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.titleRow}>
              <Text style={settingsStyles.rowTitle}>{t("settings.host.dataRelay.cardTitle")}</Text>
              <View style={[styles.badge, badgeStyle]}>
                <Text style={styles.badgeLabel}>{badgeText}</Text>
              </View>
            </View>
            <Text style={settingsStyles.rowHint}>{summary}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpenModal}
            disabled={!isConnected || isLoading}
            testID="data-relay-configure-button"
          >
            {state.isConfigured
              ? t("settings.host.dataRelay.editConfig")
              : t("settings.host.dataRelay.setup")}
          </Button>
        </View>
      </View>

      {isModalOpen ? (
        <DataRelayConfigSheet
          visible
          host={host}
          isSaving={isSaving}
          onClose={handleCloseModal}
          onSave={handleSave}
          onDisable={handleDisable}
          initialListen={state.listen}
          initialEndpoint={state.endpoint}
          initialPublicEndpoint={state.publicEndpoint}
          initialUseTls={state.useTls}
          initialAccessToken={state.accessToken}
          isConfigured={state.isConfigured}
        />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  badge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  badgeInactive: {
    backgroundColor: theme.colors.surface2,
  },
  badgeConnected: {
    backgroundColor: "rgba(74, 222, 128, 0.15)",
  },
  badgeHosting: {
    backgroundColor: "rgba(168, 85, 247, 0.15)",
  },
  badgeLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[3],
  },
  modeTabs: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[1],
    gap: theme.spacing[1],
    marginBottom: theme.spacing[3],
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  modeTabActive: {
    backgroundColor: theme.colors.surface3,
  },
  modeTabText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
  modeTabTextActive: {
    color: theme.colors.foreground,
  },
  modeHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[3],
    lineHeight: 18,
  },
  field: {
    gap: theme.spacing[1.5],
    marginBottom: theme.spacing[3],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  labelWithAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  textButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  textButtonLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.medium,
  },
  fieldHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  inputFlex: {
    flex: 1,
  },
  inputWithAddon: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  addonButton: {
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[2],
    marginBottom: theme.spacing[3],
  },
  switchContent: {
    flex: 1,
    marginRight: theme.spacing[3],
  },
  switchTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  switchHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));
