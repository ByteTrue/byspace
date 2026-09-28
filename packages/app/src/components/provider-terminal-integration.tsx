import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { TerminalAgentHookProviderId } from "@bytetrue/protocol/messages";
import {
  DEFAULT_TERMINAL_PROFILES,
  findTerminalProfileForProvider,
} from "@bytetrue/protocol/terminal-profiles";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { settingsStyles } from "@/styles/settings";
import {
  createTerminalAgentHookPatch,
  isTerminalAgentHookProviderEnabled,
} from "@/screens/settings/terminal-agent-hooks-config";
import {
  TerminalProfileEditModal,
  type ProfileDraft,
} from "@/screens/settings/terminal-profile-edit-modal";
import { applyProviderProfileDraft, draftFromProfile } from "./provider-terminal-profile-save";

/**
 * The Terminal tab of a provider's detail sheet: how BySpace talks to this
 * agent when it runs in a terminal rather than as a BySpace agent session.
 *
 * The two controls here are deliberately independent. Provider `enabled`
 * decides whether you can start a BySpace agent session with this backend;
 * the hook switch decides whether it reports terminal activity. Turning a
 * provider off must not turn its hook off — see
 * `byissue/decisions/001-settings-taxonomy-and-integration-layers.md`.
 */

interface ProviderTerminalIntegrationProps {
  serverId: string;
  provider: TerminalAgentHookProviderId;
}

export function ProviderTerminalIntegration({
  serverId,
  provider,
}: ProviderTerminalIntegrationProps) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const supportsHookSettings = useHostFeature(serverId, "terminalAgentHookProviders");
  const [isEditing, setIsEditing] = useState(false);

  const hookEnabled = isTerminalAgentHookProviderEnabled(
    config?.terminalAgentHooks,
    config?.enableTerminalAgentHooks === true,
    provider,
  );

  const handleHookChange = useCallback(
    (next: boolean) => {
      void patchConfig(createTerminalAgentHookPatch(provider, next)).catch((error) => {
        Alert.alert(
          t("settings.host.terminalAgentHooks.updateErrorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, provider, t],
  );

  // The list this sheet writes is the persisted one, exactly like the profiles
  // list in Overview: any save replaces the whole array, so resolving first
  // would bake read-time prompt adoption into the user's config.
  const persistedProfiles = useMemo(
    () => config?.terminalProfiles ?? DEFAULT_TERMINAL_PROFILES,
    [config?.terminalProfiles],
  );
  const profile = useMemo(
    () => findTerminalProfileForProvider(persistedProfiles, provider),
    [persistedProfiles, provider],
  );
  // Same text the Overview list shows, so the two surfaces agree.
  const commandText = profile ? [profile.command, ...(profile.args ?? [])].join(" ") : null;

  const initialDraft = useMemo<ProfileDraft>(
    () =>
      profile
        ? draftFromProfile(profile)
        : {
            name: DEFAULT_TERMINAL_PROFILES.find((p) => p.id === provider)?.name ?? provider,
            command: provider,
            args: "",
          },
    [profile, provider],
  );

  const handleSave = useCallback(
    async (next: ProfileDraft) => {
      await patchConfig({
        terminalProfiles: applyProviderProfileDraft(persistedProfiles, provider, next),
      });
      setIsEditing(false);
    },
    [patchConfig, persistedProfiles, provider],
  );

  const handleOpenEdit = useCallback(() => setIsEditing(true), []);
  const handleCloseEdit = useCallback(() => setIsEditing(false), []);

  return (
    <View style={styles.container} testID="provider-terminal-integration">
      {supportsHookSettings ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderTitle}>
              {t("settings.host.terminalAgentHooks.sectionTitle")}
            </Text>
            <Text style={styles.sectionHint}>
              {t("settings.host.terminalAgentHooks.sectionHint")}
            </Text>
          </View>
          <View style={settingsStyles.card} testID="provider-terminal-hooks-card">
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.host.terminalAgentHooks.reportTitle")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.host.terminalAgentHooks.reportHint")}
                </Text>
              </View>
              <Switch
                value={hookEnabled}
                disabled={!config}
                onValueChange={handleHookChange}
                accessibilityLabel={t("settings.host.terminalAgentHooks.reportTitle")}
                testID={`provider-terminal-hooks-${provider}-switch`}
              />
            </View>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={settingsStyles.sectionHeaderTitle}>
            {t("settings.host.terminalProfiles.providerTitle")}
          </Text>
          <Text style={styles.sectionHint}>{t("settings.host.terminalProfiles.providerHint")}</Text>
        </View>
        <View style={settingsStyles.card} testID="provider-terminal-profile-card">
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {profile ? profile.name : t("settings.host.terminalProfiles.providerEmpty")}
              </Text>
              <Text style={styles.commandText} numberOfLines={2}>
                {commandText ?? t("settings.host.terminalProfiles.providerMissingHint")}
              </Text>
            </View>
            <Button
              variant="outline"
              size="sm"
              onPress={handleOpenEdit}
              disabled={!config}
              testID={`provider-terminal-profile-edit-${provider}`}
            >
              {profile
                ? t("settings.host.terminalProfiles.editProfile")
                : t("settings.host.terminalProfiles.addProfile")}
            </Button>
          </View>
        </View>
      </View>

      {isEditing ? (
        <TerminalProfileEditModal
          visible
          title={
            profile
              ? t("settings.host.terminalProfiles.editProfileTitle")
              : t("settings.host.terminalProfiles.addProfileTitle")
          }
          initialDraft={initialDraft}
          onClose={handleCloseEdit}
          onSave={handleSave}
          testID="provider-terminal-profile-modal"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionHeader: {
    gap: theme.spacing[1],
    marginLeft: theme.spacing[1],
  },
  sectionHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  commandText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
}));
