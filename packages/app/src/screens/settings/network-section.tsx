import { Eye, EyeOff } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { restartDaemonFromSettings } from "@/screens/settings/daemon-restart";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHosts,
  useHostMutations,
} from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";

const mutedColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: { colors: { destructive: string } }) => ({
  color: theme.colors.destructive,
});

const ThemedEye = withUnistyles(Eye);
const ThemedEyeOff = withUnistyles(EyeOff);

/**
 * Daemon network settings: access password and LAN exposure. Backed by the
 * daemonNetworkConfig feature gate; the server enforces the password-before-LAN
 * invariant, applies both changes on restart.
 */
export function NetworkSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(daemonNetworkConfig): old daemons silently drop the network/auth
  // patches, so the section must hide instead of letting a save appear to work.
  const supportsNetworkSettings = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.daemonNetworkConfig === true,
  );
  const { config, patchConfig } = useDaemonConfig(serverId);
  const daemonClient = useHostRuntimeClient(serverId);
  const hosts = useHosts();
  const { upsertDirectConnection } = useHostMutations();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const passwordSet = config?.auth?.passwordSet === true;
  const allowLanAccess = config?.network?.allowLanAccess === true;
  const tcpPort = config?.network?.tcpPort ?? null;

  const handleOpenSheet = useCallback(() => setIsSheetOpen(true), []);
  const handleCloseSheet = useCallback(() => setIsSheetOpen(false), []);

  const applyPatch = useCallback(
    async (patch: MutableDaemonConfigPatch): Promise<boolean> => {
      setIsBusy(true);
      setError(null);
      try {
        await patchConfig(patch);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setIsBusy(false);
      }
    },
    [patchConfig],
  );

  const promptRestart = useCallback(() => {
    setNeedsRestart(true);
    void confirmDialog({
      title: t("settings.host.network.restartPrompt.title"),
      message: t("settings.host.network.restartPrompt.message"),
      confirmLabel: t("settings.host.network.restartPrompt.confirm"),
      cancelLabel: t("settings.host.network.restartPrompt.later"),
      destructive: false,
    })
      .then((confirmed) => {
        if (!confirmed || !daemonClient) return;
        return restartDaemonFromSettings(serverId, `settings_network_change_${serverId}`, {
          restartServer: (reason) => daemonClient.restartServer(reason),
        }).catch((err) => {
          console.error("[NetworkSection] Failed to restart daemon", err);
          Alert.alert(t("settings.host.network.restartPrompt.failedTitle"));
        });
      })
      .catch((err) => {
        console.error("[NetworkSection] Failed to open restart confirmation", err);
      });
  }, [daemonClient, serverId, t]);

  // Keep the app's own direct-TCP profiles in sync so reconnecting after the
  // restart uses the new password. Relay and SSH profiles carry different
  // credentials and are left alone.
  const syncLocalProfilePassword = useCallback(
    (password: string | null) => {
      const host = hosts.find((entry) => entry.serverId === serverId);
      const direct = host?.connections.find((connection) => connection.type === "directTcp");
      if (!direct) return;
      void upsertDirectConnection({
        serverId,
        endpoint: direct.endpoint,
        useTls: direct.useTls,
        ...(password ? { password } : {}),
      }).catch((err) => {
        // Without the stored password the reconnect after the restart fails
        // with 401 — surface it instead of leaving a silent trap.
        console.error("[NetworkSection] Failed to update local connection password", err);
        Alert.alert(t("settings.host.network.password.profileSyncFailed"));
      });
    },
    [hosts, serverId, t, upsertDirectConnection],
  );

  const handleSavePassword = useCallback(
    async (password: string | null) => {
      const saved = await applyPatch({ auth: { password } });
      if (!saved) return;
      syncLocalProfilePassword(password);
      promptRestart();
      setIsSheetOpen(false);
    },
    [applyPatch, promptRestart, syncLocalProfilePassword],
  );

  const handleAllowLanChange = useCallback(
    async (next: boolean) => {
      if (await applyPatch({ network: { allowLanAccess: next } })) {
        promptRestart();
      }
    },
    [applyPatch, promptRestart],
  );

  // Plain string per render; the branches map to real UI states and a memo
  // only obscures which dependency changes them.
  let lanHint: string;
  if (tcpPort === null) {
    lanHint = t("settings.host.network.allowLan.noTcp");
  } else if (passwordSet) {
    lanHint = t("settings.host.network.allowLan.hint", { port: tcpPort });
  } else {
    lanHint = t("settings.host.network.allowLan.noPassword");
  }

  if (!supportsNetworkSettings) {
    // Old daemon: patches would be dropped silently. Hide the section.
    return null;
  }

  if (!isConnected) {
    return (
      <SettingsSection title={t("settings.host.network.sectionTitle")}>
        <View style={settingsStyles.card}>
          <Text style={settingsStyles.rowHint}>{t("settings.host.network.unavailable")}</Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={t("settings.host.network.sectionTitle")}>
      {error ? (
        <View style={styles.errorWrap}>
          <InlineAlert
            variant="error"
            title={t("settings.host.network.saveError")}
            description={error}
            testID="host-page-network-error"
          />
        </View>
      ) : null}
      {needsRestart ? (
        <View style={styles.errorWrap}>
          <InlineAlert
            variant="info"
            title={t("settings.host.network.restartHint")}
            testID="host-page-network-restart-hint"
          />
        </View>
      ) : null}
      <View style={settingsStyles.card} testID="host-page-network-card">
        <Pressable
          style={[settingsStyles.row, settingsStyles.rowBorder]}
          onPress={handleOpenSheet}
          accessibilityRole="button"
          testID="host-page-network-password-row"
        >
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.host.network.password.title")}</Text>
            <Text style={settingsStyles.rowHint}>
              {passwordSet
                ? t("settings.host.network.password.setHint")
                : t("settings.host.network.password.unsetHint")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpenSheet}
            disabled={isBusy}
            testID="host-page-network-password-edit"
          >
            {t("settings.host.network.password.edit")}
          </Button>
        </Pressable>

        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.host.network.allowLan.title")}</Text>
            <Text style={settingsStyles.rowHint}>{lanHint}</Text>
          </View>
          <Switch
            value={allowLanAccess}
            disabled={isBusy || tcpPort === null || (!passwordSet && !allowLanAccess)}
            onValueChange={handleAllowLanChange}
            accessibilityLabel={t("settings.host.network.allowLan.title")}
            testID="host-page-network-allow-lan-switch"
          />
        </View>
      </View>

      <PasswordSheet
        visible={isSheetOpen}
        passwordSet={passwordSet}
        allowLanAccess={allowLanAccess}
        isBusy={isBusy}
        error={error}
        onClose={handleCloseSheet}
        onSave={handleSavePassword}
      />
    </SettingsSection>
  );
}

function PasswordSheet({
  visible,
  passwordSet,
  allowLanAccess,
  isBusy,
  error,
  onClose,
  onSave,
}: {
  visible: boolean;
  passwordSet: boolean;
  allowLanAccess: boolean;
  isBusy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (password: string | null) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const handleToggleVisibility = useCallback(
    () => setIsPasswordVisible((previous) => !previous),
    [],
  );
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.network.password.sheetTitle") }),
    [t],
  );

  const canSave = password.trim().length > 0;
  // The daemon rejects clearing the password while LAN access is enabled, so
  // keep the action unavailable instead of surfacing a server error.
  const canClear = passwordSet && !allowLanAccess;

  const handleSave = useCallback(() => {
    if (!canSave || isBusy) return;
    onSave(password.trim());
  }, [canSave, isBusy, onSave, password]);

  const handleClear = useCallback(() => {
    if (isBusy) return;
    onSave(null);
  }, [isBusy, onSave]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="host-page-network-password-sheet"
      desktopMaxWidth={480}
    >
      <Field
        label={t("settings.host.network.password.fieldLabel")}
        hint={t("settings.host.network.password.fieldHint")}
        error={error}
        testID="host-page-network-password"
      >
        <View style={styles.passwordRow}>
          <View style={styles.passwordInputWrap}>
            <FormTextInput
              size="sm"
              testID="host-page-network-password-input"
              accessibilityLabel={t("settings.host.network.password.fieldLabel")}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!isPasswordVisible}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
          </View>
          <Pressable
            style={styles.iconButton}
            onPress={handleToggleVisibility}
            accessibilityRole="button"
            accessibilityLabel={t("settings.host.network.password.toggleVisibility")}
            testID="host-page-network-password-visibility"
          >
            {isPasswordVisible ? (
              <ThemedEyeOff size={16} uniProps={mutedColorMapping} />
            ) : (
              <ThemedEye size={16} uniProps={mutedColorMapping} />
            )}
          </Pressable>
        </View>
      </Field>
      <View style={styles.sheetActions}>
        {canClear ? (
          <Button
            variant="ghost"
            size="sm"
            textStyle={destructiveColorMapping as never}
            onPress={handleClear}
            disabled={isBusy}
            testID="host-page-network-password-clear"
          >
            {t("settings.host.network.password.clear")}
          </Button>
        ) : null}
        <Button
          variant="default"
          size="sm"
          onPress={handleSave}
          disabled={!canSave || isBusy}
          testID="host-page-network-password-save"
        >
          {t("settings.host.network.password.save")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  errorWrap: {
    marginBottom: theme.spacing[2],
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  passwordInputWrap: {
    flex: 1,
  },
  iconButton: {
    padding: theme.spacing[1],
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
  },
}));
