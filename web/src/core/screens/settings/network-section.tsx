// Port of archive/expo-app:packages/app/src/screens/settings/network-section.tsx: access password and LAN exposure, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/settings-small-sections.py; edit it directly.
import { CircleAlert, Eye, EyeOff, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { useCallback, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { restartDaemonFromSettings } from "@/screens/settings/daemon-restart";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { MutableDaemonConfigPatch } from "@bytetrue/protocol/messages";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHosts,
  useHostMutations,
} from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { withTheme } from "~/app/theme-object";
import { showAlert } from "~/lib/alert";
import { Input } from "~/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";

const mutedColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedEye = withTheme(Eye);
const ThemedEyeOff = withTheme(EyeOff);

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
      title: t("settings.host.daemon.network.restartPrompt.title"),
      message: t("settings.host.daemon.network.restartPrompt.message"),
      confirmLabel: t("settings.host.daemon.network.restartPrompt.confirm"),
      cancelLabel: t("settings.host.daemon.network.restartPrompt.later"),
      destructive: false,
    })
      .then((confirmed) => {
        if (!confirmed || !daemonClient) return;
        return restartDaemonFromSettings(serverId, `settings_network_change_${serverId}`, {
          restartServer: (reason) => daemonClient.restartServer(reason),
        }).catch((err) => {
          console.error("[NetworkSection] Failed to restart daemon", err);
          showAlert(t("settings.host.daemon.network.restartPrompt.failedTitle"));
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
        showAlert(t("settings.host.daemon.network.password.profileSyncFailed"));
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
    lanHint = t("settings.host.daemon.network.allowLan.noTcp");
  } else if (passwordSet) {
    lanHint = t("settings.host.daemon.network.allowLan.hint", { port: tcpPort });
  } else {
    lanHint = t("settings.host.daemon.network.allowLan.noPassword");
  }

  if (!supportsNetworkSettings) {
    // Old daemon: patches would be dropped silently. Hide the section.
    return null;
  }

  if (!isConnected) {
    return (
      <SettingsSection title={t("settings.host.daemon.network.sectionTitle")}>
        <div className={settingsStyles.card}>
          <span className={settingsStyles.rowHint}>
            {t("settings.host.daemon.network.unavailable")}
          </span>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={t("settings.host.daemon.network.sectionTitle")}>
      {error ? (
        <div className="mb-2">
          <Alert variant="destructive" data-testid="host-page-network-error">
            <CircleAlert />
            <AlertTitle>{t("settings.host.daemon.network.saveError")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {needsRestart ? (
        <div className="mb-2">
          <Alert data-testid="host-page-network-restart-hint">
            <Info />
            <AlertTitle>{t("settings.host.daemon.network.restartHint")}</AlertTitle>
          </Alert>
        </div>
      ) : null}
      <div className={settingsStyles.card} data-testid="host-page-network-card">
        <div
          className={cn(settingsStyles.row, settingsStyles.rowBorder, "cursor-pointer")}
          onClick={handleOpenSheet}
          role="button"
          tabIndex={-1}
          data-testid="host-page-network-password-row"
        >
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>
              {t("settings.host.daemon.network.password.title")}
            </span>
            <span className={settingsStyles.rowHint}>
              {passwordSet
                ? t("settings.host.daemon.network.password.setHint")
                : t("settings.host.daemon.network.password.unsetHint")}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpenSheet}
            disabled={isBusy}
            testID="host-page-network-password-edit"
          >
            {t("settings.host.daemon.network.password.edit")}
          </Button>
        </div>

        <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>
              {t("settings.host.daemon.network.allowLan.title")}
            </span>
            <span className={settingsStyles.rowHint}>{lanHint}</span>
          </div>
          <Switch
            checked={allowLanAccess}
            disabled={isBusy || tcpPort === null || (!passwordSet && !allowLanAccess)}
            onCheckedChange={handleAllowLanChange}
            aria-label={t("settings.host.daemon.network.allowLan.title")}
            data-testid="host-page-network-allow-lan-switch"
          />
        </div>
      </div>

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
  const handlePasswordInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value),
    [setPassword],
  );
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const handleToggleVisibility = useCallback(
    () => setIsPasswordVisible((previous) => !previous),
    [],
  );
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.daemon.network.password.sheetTitle") }),
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
  const handleSaveEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleSave();
    },
    [handleSave],
  );

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
      <Field data-testid="host-page-network-password" data-invalid={Boolean(error)}>
        <FieldLabel>{t("settings.host.daemon.network.password.fieldLabel")}</FieldLabel>
        <div className="flex flex-row items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              data-testid="host-page-network-password-input"
              aria-label={t("settings.host.daemon.network.password.fieldLabel")}
              onChange={handlePasswordInput}
              autoCapitalize="none"
              autoCorrect="off"
              type={isPasswordVisible ? "text" : "password"}
              enterKeyHint="done"
              onKeyDown={handleSaveEnter}
            />
          </div>
          <button
            type="button"
            className="p-1"
            onClick={handleToggleVisibility}
            aria-label={t("settings.host.daemon.network.password.toggleVisibility")}
            data-testid="host-page-network-password-visibility"
          >
            {isPasswordVisible ? (
              <ThemedEyeOff size={16} themeProps={mutedColorMapping} />
            ) : (
              <ThemedEye size={16} themeProps={mutedColorMapping} />
            )}
          </button>
        </div>
        <FieldDescription data-testid="host-page-network-password-hint">
          {t("settings.host.daemon.network.password.fieldHint")}
        </FieldDescription>
        <FieldError data-testid="host-page-network-password-error">{error}</FieldError>
      </Field>
      <div className="mt-4 flex flex-row items-center justify-end gap-2">
        {canClear ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onPress={handleClear}
            disabled={isBusy}
            testID="host-page-network-password-clear"
          >
            {t("settings.host.daemon.network.password.clear")}
          </Button>
        ) : null}
        <Button
          variant="default"
          size="sm"
          onPress={handleSave}
          disabled={!canSave || isBusy}
          testID="host-page-network-password-save"
        >
          {t("settings.host.daemon.network.password.save")}
        </Button>
      </div>
    </AdaptiveModalSheet>
  );
}
