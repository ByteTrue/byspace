import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
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
import { useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useTranslation } from "react-i18next";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const remoteWebServiceTargetOptionTestID = (serverId: string) =>
  `remote-web-service-target-option-${serverId}`;

interface TargetHost {
  serverId: string;
  label: string;
  daemonPublicKeyB64: string;
}

function resolveRelayPublicKey(host: HostProfile): string | null {
  return (
    host.connections.find((connection) => connection.type === "relay")?.daemonPublicKeyB64 ?? null
  );
}

function resolveEmptyMessage(input: {
  isConnected: boolean;
  isDataRelayConfigured: boolean;
  hasTargets: boolean;
  disconnected: string;
  empty: string;
  noCompatibleTargets: string;
  relayNotConfigured: string;
}): string {
  if (!input.isConnected) return input.disconnected;
  if (!input.isDataRelayConfigured) return input.relayNotConfigured;
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
  const handleRemove = useCallback(() => onRemove(service), [onRemove, service]);

  return (
    <View
      style={[settingsStyles.row, showBorder && settingsStyles.rowBorder]}
      testID={`remote-web-service-row-${service.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{service.name}</Text>
        <Text style={settingsStyles.rowHint} selectable>
          {service.localUrl ?? service.hostname}
        </Text>
        <Text style={styles.targetHint}>
          {t("settings.host.remoteWebServices.targetSummary", {
            host: service.target.label,
            port: service.target.port,
          })}
        </Text>
      </View>
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

      <View style={styles.field}>
        <Text style={styles.label}>{t("settings.host.remoteWebServices.nameLabel")}</Text>
        <AdaptiveTextInput
          initialValue={name}
          value={name}
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
          value={port}
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
        const candidateInfo = sessions[candidate.serverId]?.serverInfo;
        if (candidateInfo?.features?.remoteWebServices !== true) return [];
        if (candidateInfo.dataRelay?.configured !== true) return [];
        const daemonPublicKeyB64 =
          candidateInfo.daemonPublicKeyB64 ?? resolveRelayPublicKey(candidate);
        if (!daemonPublicKeyB64) return [];
        return [{ serverId: candidate.serverId, label: candidate.label, daemonPublicKeyB64 }];
      }),
    [host.serverId, hosts, sessions],
  );

  const emptyMessage = resolveEmptyMessage({
    isConnected,
    isDataRelayConfigured,
    hasTargets: targetHosts.length > 0,
    disconnected: t("settings.host.remoteWebServices.disconnected"),
    empty: t("settings.host.remoteWebServices.empty"),
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
    fontSize: theme.fontSize.xs,
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
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
    fontSize: theme.fontSize.sm,
  },
  selectorPlaceholder: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));
