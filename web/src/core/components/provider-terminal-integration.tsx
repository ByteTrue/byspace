// Port of archive/expo-app:packages/app/src/components/provider-terminal-integration.tsx: the Terminal tab of a provider's settings sheet; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/provider-diagnostic-sheet.py; edit it directly.
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TerminalAgentHookProviderId } from "@bytetrue/protocol/messages";
import {
  DEFAULT_TERMINAL_PROFILES,
  findTerminalProfileForProvider,
} from "@bytetrue/protocol/terminal-profiles";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
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
import {
  applyProviderProfileDraft,
  draftFromProfile,
} from "@/components/provider-terminal-profile-save";
import { showAlert } from "~/lib/alert";

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
        showAlert(
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
    <div className="flex flex-col gap-4" data-testid="provider-terminal-integration">
      {supportsHookSettings ? (
        <div className="flex flex-col gap-2">
          <div className="ml-1 flex flex-col gap-1">
            <span className={settingsStyles.sectionHeaderTitle}>
              {t("settings.host.terminalAgentHooks.sectionTitle")}
            </span>
            <span className="text-xs leading-[normal] text-muted-foreground">
              {t("settings.host.terminalAgentHooks.sectionHint")}
            </span>
          </div>
          <div className={settingsStyles.card} data-testid="provider-terminal-hooks-card">
            <div className={settingsStyles.row}>
              <div className={settingsStyles.rowContent}>
                <span className={settingsStyles.rowTitle}>
                  {t("settings.host.terminalAgentHooks.reportTitle")}
                </span>
                <span className={settingsStyles.rowHint}>
                  {t("settings.host.terminalAgentHooks.reportHint")}
                </span>
              </div>
              <Switch
                checked={hookEnabled}
                disabled={!config}
                onCheckedChange={handleHookChange}
                aria-label={t("settings.host.terminalAgentHooks.reportTitle")}
                data-testid={`provider-terminal-hooks-${provider}-switch`}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="ml-1 flex flex-col gap-1">
          <span className={settingsStyles.sectionHeaderTitle}>
            {t("settings.host.terminalProfiles.providerTitle")}
          </span>
          <span className="text-xs leading-[normal] text-muted-foreground">
            {t("settings.host.terminalProfiles.providerHint")}
          </span>
        </div>
        <div className={settingsStyles.card} data-testid="provider-terminal-profile-card">
          <div className={settingsStyles.row}>
            <div className={settingsStyles.rowContent}>
              <span className={settingsStyles.rowTitle}>
                {profile ? profile.name : t("settings.host.terminalProfiles.providerEmpty")}
              </span>
              <span className="line-clamp-2 text-xs leading-[normal] text-muted-foreground">
                {commandText ?? t("settings.host.terminalProfiles.providerMissingHint")}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenEdit}
              data-testid={`provider-terminal-profile-edit-${provider}`}
              disabled={!config}
            >
              {profile
                ? t("settings.host.terminalProfiles.editProfile")
                : t("settings.host.terminalProfiles.addProfile")}
            </Button>
          </div>
        </div>
      </div>

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
    </div>
  );
}
