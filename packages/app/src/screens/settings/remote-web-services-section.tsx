import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { RemoteWebService } from "@bytetrue/byspace-protocol/messages";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { HostPicker } from "@/components/hosts/host-picker";
import { Button } from "@/components/ui/button";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { useToast } from "@/contexts/toast-context";
import { useRemoteWebServices } from "@/hooks/use-remote-web-services";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useTranslation } from "react-i18next";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const remoteWebServiceTargetOptionTestID = (serverId: string) =>
  `remote-web-service-target-option-${serverId}`;

interface TargetHost {
  serverId: string;
  label: string;
  daemonPublicKeyB64: string;
}

interface PresetItem {
  label: string;
  port: string;
  defaultName: string;
}

function PresetPill({
  preset,
  onPress,
  disabled,
}: {
  preset: PresetItem;
  onPress: (preset: PresetItem) => void;
  disabled: boolean;
}) {
  const handlePress = useCallback(() => onPress(preset), [onPress, preset]);
  return (
    <Pressable style={styles.presetPill} onPress={handlePress} disabled={disabled}>
      <Text style={styles.presetPillText}>{preset.label}</Text>
    </Pressable>
  );
}

const COMMON_PRESETS = [
  { label: "Vite (5173)", port: "5173", defaultName: "dev-web" },
  { label: "Next.js (3000)", port: "3000", defaultName: "app-web" },
  { label: "AI Gateway (8317)", port: "8317", defaultName: "office-ai" },
  { label: "Ollama (11434)", port: "11434", defaultName: "ollama" },
];

function resolveRelayPublicKey(host: HostProfile): string | null {
  return (
    host.connections.find((connection) => connection.type === "relay")?.daemonPublicKeyB64 ?? null
  );
}

function resolveEmptyMessage(input: {
  isConnected: boolean;
  isDataRelayConfigured: boolean;
  hasOtherHosts: boolean;
  hasTargets: boolean;
  disconnected: string;
  empty: string;
  noOtherHosts: string;
  noCompatibleTargets: string;
  relayNotConfigured: string;
}): string {
  if (!input.isConnected) return input.disconnected;
  if (!input.isDataRelayConfigured) return input.relayNotConfigured;
  if (!input.hasOtherHosts) return input.noOtherHosts;
  if (!input.hasTargets) return input.noCompatibleTargets;
  return input.empty;
}

function RemoteWebServiceRow({
  service,
  showBorder,
  isRemoving,
  onRemove,
}: {
  service: RemoteWebService;
  showBorder: boolean;
  isRemoving: boolean;
  onRemove: (service: RemoteWebService) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [hasCopied, setHasCopied] = useState(false);
  const handleRemove = useCallback(() => onRemove(service), [onRemove, service]);
  const url = service.localUrl ?? `http://${service.hostname}`;

  const handleCopyUrl = useCallback(() => {
    void copyToClipboard(url).then(() => {
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
      toast.show(t("settings.host.remoteWebServices.urlCopied"));
      return undefined;
    });
  }, [t, toast, url]);

  const handleOpenUrl = useCallback(() => {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [url]);

  return (
    <View
      style={[settingsStyles.row, showBorder && settingsStyles.rowBorder]}
      testID={`remote-web-service-row-${service.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{service.name}</Text>
        <Text style={settingsStyles.rowHint} selectable>
          {url}
        </Text>
        <Text style={styles.targetHint}>
          {t("settings.host.remoteWebServices.targetSummary", {
            host: service.target.label,
            port: service.target.port,
          })}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleCopyUrl}
          accessibilityLabel={t("settings.host.remoteWebServices.copyUrl")}
          testID={`remote-web-service-copy-${service.id}`}
        >
          {hasCopied ? t("common.actions.copied") : t("common.actions.copy")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleOpenUrl}
          accessibilityLabel={t("settings.host.remoteWebServices.openUrl")}
          testID={`remote-web-service-open-${service.id}`}
        >
          {t("settings.host.remoteWebServices.open")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleRemove}
          disabled={isRemoving}
          accessibilityLabel={t("settings.host.remoteWebServices.removeTitle", {
            name: service.name,
          })}
          testID={`remote-web-service-remove-${service.id}`}
        >
          {isRemoving
            ? t("settings.host.remoteWebServices.removing")
            : t("settings.host.remoteWebServices.remove")}
        </Button>
      </View>
    </View>
  );
}

function AddRemoteWebServiceSheet({
  visible,
  sourceHost,
  targetHosts,
  isSaving,
  onClose,
  onSave,
}: {
  visible: boolean;
  sourceHost: HostProfile;
  targetHosts: TargetHost[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: { name: string; target: TargetHost; port: number }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [targetServerId, setTargetServerId] = useState(targetHosts[0]?.serverId ?? "");
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetAnchorRef = useRef<View | null>(null);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.remoteWebServices.addTitle") }),
    [t],
  );
  const target = targetHosts.find((host) => host.serverId === targetServerId) ?? targetHosts[0];

  const handleClose = useCallback(() => {
    if (!isSaving) onClose();
  }, [isSaving, onClose]);

  const handleOpenTargetPicker = useCallback(() => setTargetPickerOpen(true), []);

  const handleApplyPreset = useCallback((preset: (typeof COMMON_PRESETS)[number]) => {
    setPort(preset.port);
    setName((current) => (current.trim() ? current : preset.defaultName));
  }, []);

  const handleSave = useCallback(() => {
    const parsedPort = Number(port.trim());
    if (!name.trim()) {
      setError(t("settings.host.remoteWebServices.nameRequired"));
      return;
    }
    if (!target) {
      setError(t("settings.host.remoteWebServices.targetRequired"));
      return;
    }
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
      setError(t("settings.host.remoteWebServices.invalidPort"));
      return;
    }
    setError(null);
    void onSave({ name: name.trim(), target, port: parsedPort }).catch((saveError) => {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    });
  }, [name, onSave, port, t, target]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      desktopMaxWidth={480}
      testID="add-remote-web-service-sheet"
    >
      <Text style={styles.helper}>
        {t("settings.host.remoteWebServices.addHint", { source: sourceHost.label })}
      </Text>

      {/* Presets */}
      <View style={styles.presetsContainer}>
        <Text style={styles.presetsLabel}>{t("settings.host.remoteWebServices.presets")}:</Text>
        <View style={styles.presetsRow}>
          {COMMON_PRESETS.map((preset) => (
            <PresetPill
              key={preset.port}
              preset={preset}
              onPress={handleApplyPreset}
              disabled={isSaving}
            />
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("settings.host.remoteWebServices.nameLabel")}</Text>
        <AdaptiveTextInput
          initialValue={name}
          onChangeText={setName}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          accessibilityLabel={t("settings.host.remoteWebServices.nameLabel")}
          placeholder={t("settings.host.remoteWebServices.namePlaceholder")}
          testID="remote-web-service-name-input"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("settings.host.remoteWebServices.targetLabel")}</Text>
        <HostPicker
          hosts={targetHosts}
          value={target?.serverId ?? ""}
          onSelect={setTargetServerId}
          open={targetPickerOpen}
          onOpenChange={setTargetPickerOpen}
          anchorRef={targetAnchorRef}
          searchable
          title={t("settings.host.remoteWebServices.targetLabel")}
          hostOptionTestID={remoteWebServiceTargetOptionTestID}
        >
          <ComboboxTrigger
            testID="remote-web-service-target-trigger"
            ref={targetAnchorRef}
            block
            style={styles.selector}
            onPress={handleOpenTargetPicker}
            disabled={isSaving || targetHosts.length === 0}
            accessibilityRole="button"
            accessibilityLabel={t("settings.host.remoteWebServices.targetLabel")}
          >
            <Text style={target ? styles.selectorValue : styles.selectorPlaceholder}>
              {target?.label ?? t("settings.host.remoteWebServices.noTargets")}
            </Text>
          </ComboboxTrigger>
        </HostPicker>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("settings.host.remoteWebServices.portLabel")}</Text>
        <AdaptiveTextInput
          initialValue={port}
          onChangeText={setPort}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          editable={!isSaving}
          accessibilityLabel={t("settings.host.remoteWebServices.portLabel")}
          placeholder="5173"
          testID="remote-web-service-port-input"
        />
        <Text style={styles.helper}>{t("settings.host.remoteWebServices.portHint")}</Text>
      </View>

      {/* URL Preview */}
      <View style={styles.previewContainer}>
        <Text style={styles.previewLabel}>
          {t("settings.host.remoteWebServices.previewLabel")}:
        </Text>
        <Text style={styles.previewUrl} numberOfLines={1}>
          http://{name.trim() || "service"}.remote.localhost
        </Text>
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          variant="secondary"
          style={FLEX_ONE_STYLE}
          onPress={handleClose}
          disabled={isSaving}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          style={FLEX_ONE_STYLE}
          onPress={handleSave}
          disabled={isSaving || targetHosts.length === 0}
          testID="remote-web-service-create"
        >
          {isSaving
            ? t("settings.host.remoteWebServices.creating")
            : t("settings.host.remoteWebServices.create")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

function RemoteWebServicesCard({
  services,
  isConnected,
  isLoading,
  error,
  emptyMessage,
  canAdd,
  removingId,
  onAdd,
  onRemove,
}: {
  services: RemoteWebService[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  emptyMessage: string;
  canAdd: boolean;
  removingId: string | null;
  onAdd: () => void;
  onRemove: (service: RemoteWebService) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.card} testID="remote-web-services-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.remoteWebServices.summary")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.remoteWebServices.description")}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={onAdd}
          disabled={!canAdd}
          testID="remote-web-service-add"
        >
          {t("settings.host.remoteWebServices.add")}
        </Button>
      </View>

      {!isConnected ? (
        <View
          style={[settingsStyles.row, settingsStyles.rowBorder]}
          testID="remote-web-services-disconnected"
        >
          <Text style={settingsStyles.rowHint}>{emptyMessage}</Text>
        </View>
      ) : null}
      {isConnected && isLoading ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowHint}>{t("settings.host.remoteWebServices.loading")}</Text>
        </View>
      ) : null}
      {isConnected && error ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        </View>
      ) : null}
      {isConnected && !isLoading && !error && services.length === 0 ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowHint}>{emptyMessage}</Text>
        </View>
      ) : null}
      {isConnected
        ? services.map((service) => (
            <RemoteWebServiceRow
              key={service.id}
              service={service}
              showBorder
              isRemoving={removingId === service.id}
              onRemove={onRemove}
            />
          ))
        : null}
    </View>
  );
}

export function RemoteWebServicesSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const hosts = useHosts();
  const hostServerIds = useMemo(() => hosts.map((candidate) => candidate.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(hostServerIds);
  const sessions = useSessionStore((state) => state.sessions);
  const serverInfo = sessions[host.serverId]?.serverInfo ?? null;
  const isSupported = serverInfo?.features?.remoteWebServices === true;
  const isDataRelayConfigured = serverInfo?.dataRelay?.configured === true;
  const sourceDaemonPublicKeyB64 =
    serverInfo?.daemonPublicKeyB64 ?? resolveRelayPublicKey(host) ?? undefined;
  const {
    services,
    isConnected,
    isLoading,
    error,
    createService,
    removeService,
    isCreating,
    removingId,
  } = useRemoteWebServices(host.serverId, isSupported, sourceDaemonPublicKeyB64);
  const [isAdding, setIsAdding] = useState(false);

  const targetHosts = useMemo<TargetHost[]>(
    () =>
      hosts.flatMap((candidate) => {
        if (candidate.serverId === host.serverId) return [];
        if (connectionStatuses.get(candidate.serverId) !== "online") return [];
        const candidateInfo = sessions[candidate.serverId]?.serverInfo;
        if (candidateInfo?.features?.remoteWebServices !== true) return [];
        if (candidateInfo.dataRelay?.configured !== true) return [];
        const daemonPublicKeyB64 =
          candidateInfo.daemonPublicKeyB64 ?? resolveRelayPublicKey(candidate);
        if (!daemonPublicKeyB64) return [];
        return [{ serverId: candidate.serverId, label: candidate.label, daemonPublicKeyB64 }];
      }),
    [connectionStatuses, host.serverId, hosts, sessions],
  );

  const otherHosts = useMemo(
    () => hosts.filter((candidate) => candidate.serverId !== host.serverId),
    [host.serverId, hosts],
  );

  const emptyMessage = resolveEmptyMessage({
    isConnected,
    isDataRelayConfigured,
    hasOtherHosts: otherHosts.length > 0,
    hasTargets: targetHosts.length > 0,
    disconnected: t("settings.host.remoteWebServices.disconnected"),
    empty: t("settings.host.remoteWebServices.empty"),
    noOtherHosts: t("settings.host.remoteWebServices.noOtherHosts"),
    noCompatibleTargets: t("settings.host.remoteWebServices.noCompatibleTargets"),
    relayNotConfigured: t("settings.host.remoteWebServices.relayNotConfigured"),
  });

  useEffect(() => {
    if (!isConnected) setIsAdding(false);
  }, [isConnected]);

  const handleOpen = useCallback(() => setIsAdding(true), []);
  const handleClose = useCallback(() => setIsAdding(false), []);
  const handleSave = useCallback(
    async ({ name, target, port }: { name: string; target: TargetHost; port: number }) => {
      await createService({
        name,
        target: {
          serverId: target.serverId,
          label: target.label,
          port,
          daemonPublicKeyB64: target.daemonPublicKeyB64,
        },
      });
      setIsAdding(false);
    },
    [createService],
  );
  const handleRemove = useCallback(
    (service: RemoteWebService) => {
      void confirmDialog({
        title: t("settings.host.remoteWebServices.removeTitle", { name: service.name }),
        message: t("settings.host.remoteWebServices.removeMessage"),
        confirmLabel: t("settings.host.remoteWebServices.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      })
        .then((confirmed) => {
          if (!confirmed) return;
          return removeService(service).catch((removeError) => {
            toast.error(removeError instanceof Error ? removeError.message : String(removeError));
          });
        })
        .catch((dialogError) => {
          toast.error(dialogError instanceof Error ? dialogError.message : String(dialogError));
        });
    },
    [removeService, t, toast],
  );

  if (serverInfo && !isSupported) {
    return (
      <SettingsSection title={t("settings.host.remoteWebServices.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.host.remoteWebServices.updateHost")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.host.remoteWebServices.updateHostHint")}
              </Text>
            </View>
          </View>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={t("settings.host.remoteWebServices.title")}>
      <RemoteWebServicesCard
        services={services}
        isConnected={isConnected}
        isLoading={isLoading}
        error={error}
        emptyMessage={emptyMessage}
        canAdd={
          isConnected &&
          isDataRelayConfigured &&
          Boolean(sourceDaemonPublicKeyB64) &&
          targetHosts.length > 0
        }
        removingId={removingId}
        onAdd={handleOpen}
        onRemove={handleRemove}
      />

      {isAdding ? (
        <AddRemoteWebServiceSheet
          visible
          sourceHost={host}
          targetHosts={targetHosts}
          isSaving={isCreating}
          onClose={handleClose}
          onSave={handleSave}
        />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  targetHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing[2],
  },
  presetsContainer: {
    marginBottom: theme.spacing[3],
  },
  presetsLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[1.5],
  },
  presetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  presetPill: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  presetPillText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  field: {
    gap: theme.spacing[1.5],
    marginBottom: theme.spacing[3],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  selector: {
    minHeight: 44,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  selectorValue: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  selectorPlaceholder: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  previewContainer: {
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing[3],
    gap: 4,
  },
  previewLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  previewUrl: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontFamily: theme.fontFamily.mono,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));
