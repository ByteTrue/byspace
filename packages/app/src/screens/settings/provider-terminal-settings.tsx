import type {
  MutableDaemonConfigPatch,
  TerminalProfile,
} from "@bytetrue/byspace-protocol/messages";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@bytetrue/byspace-protocol/terminal-profiles";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { getProviderIcon } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { Alert as InlineAlert } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  type ProfileDraft,
  TerminalProfileEditModal,
} from "@/screens/settings/terminal-profile-edit-modal";
import {
  filterTerminalProfiles,
  moveTerminalProfile,
  type TerminalProviderId,
} from "@/screens/settings/terminal-profile-groups";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";

const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: "", command: "", args: "" };

interface TerminalProfileIconProps {
  iconName?: string;
  size: number;
  color: string;
}

function TerminalProfileIcon({ iconName, size, color }: TerminalProfileIconProps) {
  const Icon = iconName ? getProviderIcon(iconName) : SquareTerminal;
  return <Icon size={size} color={color} />;
}

const ThemedTerminalProfileIcon = withUnistyles(TerminalProfileIcon);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedTrash = withUnistyles(Trash2);
const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedIconProps = (theme: Theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
});
const profileIconProps = (theme: Theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foregroundMuted,
});
const destructiveIconProps = (theme: Theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.destructive,
});

const EDIT_ICON = <ThemedPencil uniProps={mutedIconProps} />;
const MOVE_UP_ICON = <ThemedArrowUp uniProps={mutedIconProps} />;
const MOVE_DOWN_ICON = <ThemedArrowDown uniProps={mutedIconProps} />;
const REMOVE_ICON = <ThemedTrash uniProps={destructiveIconProps} />;

function parseArgsString(raw: string): string[] | undefined {
  const args = raw.trim().split(/\s+/).filter(Boolean);
  return args.length > 0 ? args : undefined;
}

interface TerminalProfileRowProps {
  profile: TerminalProfile;
  isFirst: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function TerminalProfileRow({
  profile,
  isFirst,
  canMoveUp,
  canMoveDown,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TerminalProfileRowProps) {
  const { t } = useTranslation();
  const icon = getTerminalProfileIcon(profile);
  const commandText =
    profile.args && profile.args.length > 0
      ? `${profile.command} ${profile.args.join(" ")}`
      : profile.command;
  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder, styles.profileRow],
    [isFirst],
  );
  const handleEdit = useCallback(() => onEdit(profile.id), [onEdit, profile.id]);
  const handleMoveUp = useCallback(() => onMoveUp(profile.id), [onMoveUp, profile.id]);
  const handleMoveDown = useCallback(() => onMoveDown(profile.id), [onMoveDown, profile.id]);
  const handleRemove = useCallback(() => onRemove(profile.id), [onRemove, profile.id]);

  return (
    <View style={rowStyle}>
      <Pressable
        style={styles.profileEditButton}
        onPress={handleEdit}
        accessibilityRole="button"
        accessibilityLabel={`${t("settings.host.terminalProfiles.editProfile")}: ${profile.name}`}
        testID={`terminal-profile-row-${profile.id}`}
      >
        <ThemedTerminalProfileIcon iconName={icon} uniProps={profileIconProps} />
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {profile.name}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {commandText}
          </Text>
        </View>
      </Pressable>
      <DropdownMenu>
        <DropdownMenuTrigger
          hitSlop={8}
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel={t("settings.providers.terminal.profileActions", {
            name: profile.name,
          })}
          testID={`terminal-profile-actions-${profile.id}`}
        >
          <ThemedMoreHorizontal uniProps={mutedIconProps} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={220}>
          <DropdownMenuItem leading={EDIT_ICON} onSelect={handleEdit}>
            {t("settings.host.terminalProfiles.editProfile")}
          </DropdownMenuItem>
          <DropdownMenuItem leading={MOVE_UP_ICON} onSelect={handleMoveUp} disabled={!canMoveUp}>
            {t("settings.host.terminalProfiles.moveUp")}
          </DropdownMenuItem>
          <DropdownMenuItem
            leading={MOVE_DOWN_ICON}
            onSelect={handleMoveDown}
            disabled={!canMoveDown}
          >
            {t("settings.host.terminalProfiles.moveDown")}
          </DropdownMenuItem>
          <DropdownMenuItem destructive leading={REMOVE_ICON} onSelect={handleRemove}>
            {t("settings.host.terminalProfiles.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface TerminalProfilesPanelProps {
  serverId: string;
  providerId: TerminalProviderId | null;
  isAdding: boolean;
  onAddClose: () => void;
}

export function TerminalProfilesPanel({
  serverId,
  providerId,
  isAdding,
  onAddClose,
}: TerminalProfilesPanelProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [editingProfile, setEditingProfile] = useState<{
    id: string;
    draft: ProfileDraft;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const allProfiles = useMemo(
    () => (config ? [...resolveTerminalProfiles(config.terminalProfiles)] : null),
    [config],
  );
  const profiles = useMemo(
    () => (allProfiles ? filterTerminalProfiles(allProfiles, providerId) : null),
    [allProfiles, providerId],
  );

  const saveProfiles = useCallback(
    async (next: TerminalProfile[]) => {
      await patchConfig({ terminalProfiles: next });
    },
    [patchConfig],
  );
  const handleAddSave = useCallback(
    async (draft: ProfileDraft) => {
      const next = allProfiles ? [...allProfiles] : [];
      next.push({
        id: crypto.randomUUID(),
        name: draft.name,
        command: draft.command,
        args: parseArgsString(draft.args),
        icon: providerId ?? undefined,
      });
      await saveProfiles(next);
    },
    [allProfiles, providerId, saveProfiles],
  );
  const handleEditOpen = useCallback(
    (id: string) => {
      const profile = allProfiles?.find((candidate) => candidate.id === id);
      if (!profile) return;
      setEditingProfile({
        id,
        draft: {
          name: profile.name,
          command: profile.command,
          args: profile.args?.join(" ") ?? "",
        },
      });
    },
    [allProfiles],
  );
  const handleEditClose = useCallback(() => setEditingProfile(null), []);
  const handleEditSave = useCallback(
    async (draft: ProfileDraft) => {
      if (!editingProfile || !allProfiles) return;
      const next = allProfiles.map((profile) =>
        profile.id === editingProfile.id
          ? {
              ...profile,
              name: draft.name,
              command: draft.command,
              args: parseArgsString(draft.args),
            }
          : profile,
      );
      await saveProfiles(next);
      setEditingProfile(null);
    },
    [allProfiles, editingProfile, saveProfiles],
  );
  const handleRemove = useCallback(
    async (id: string) => {
      const profile = allProfiles?.find((candidate) => candidate.id === id);
      if (!profile) return;
      const confirmed = await confirmDialog({
        title: t("settings.host.terminalProfiles.removeConfirmTitle"),
        message: t("settings.host.terminalProfiles.removeConfirmMessage", { name: profile.name }),
        confirmLabel: t("settings.host.terminalProfiles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed || !allProfiles) return;
      setSaveError(null);
      try {
        await saveProfiles(allProfiles.filter((candidate) => candidate.id !== id));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [allProfiles, saveProfiles, t],
  );
  const moveProfile = useCallback(
    async (id: string, offset: -1 | 1) => {
      if (!allProfiles || !profiles) return;
      const next = moveTerminalProfile(allProfiles, profiles, id, offset);
      if (!next) return;
      setSaveError(null);
      try {
        await saveProfiles(next);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [allProfiles, profiles, saveProfiles],
  );
  const handleMoveUp = useCallback((id: string) => void moveProfile(id, -1), [moveProfile]);
  const handleMoveDown = useCallback((id: string) => void moveProfile(id, 1), [moveProfile]);
  const handleDismissSaveError = useCallback(() => setSaveError(null), []);

  if (!isConnected) {
    return (
      <View style={styles.emptyCard} testID="terminal-profiles-unavailable">
        <Text style={styles.emptyText}>{t("settings.host.terminalProfiles.unavailable")}</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.profileSection}>
        <Text style={settingsStyles.sectionHeaderTitle}>
          {t("settings.providers.terminal.launchProfiles")}
        </Text>
        {saveError ? (
          <InlineAlert
            variant="error"
            title={t("common.errors.unableToSave")}
            description={saveError}
            testID="terminal-profiles-save-error"
          >
            <Button variant="secondary" size="sm" onPress={handleDismissSaveError}>
              {t("common.actions.dismiss")}
            </Button>
          </InlineAlert>
        ) : null}
        <View style={settingsStyles.card} testID="terminal-profiles-card">
          {profiles && profiles.length > 0 ? (
            profiles.map((profile, index) => (
              <TerminalProfileRow
                key={profile.id}
                profile={profile}
                isFirst={index === 0}
                canMoveUp={index > 0}
                canMoveDown={index < profiles.length - 1}
                onEdit={handleEditOpen}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t("settings.host.terminalProfiles.emptyState")}</Text>
            </View>
          )}
        </View>
      </View>

      <TerminalProfileEditModal
        visible={isAdding}
        title={t("settings.host.terminalProfiles.addProfileTitle")}
        initialDraft={EMPTY_PROFILE_DRAFT}
        onClose={onAddClose}
        onSave={handleAddSave}
        testID="terminal-profile-edit-modal"
      />

      {editingProfile ? (
        <TerminalProfileEditModal
          visible
          title={t("settings.host.terminalProfiles.editProfileTitle")}
          initialDraft={editingProfile.draft}
          onClose={handleEditClose}
          onSave={handleEditSave}
        />
      ) : null}
    </>
  );
}

export function ProviderTerminalSettings({
  serverId,
  providerId,
  isAdding,
  onAddClose,
}: {
  serverId: string;
  providerId: TerminalProviderId;
  isAdding: boolean;
  onAddClose: () => void;
}) {
  return (
    <View style={styles.providerBody}>
      <ProviderTerminalHook serverId={serverId} providerId={providerId} />
      <TerminalProfilesPanel
        serverId={serverId}
        providerId={providerId}
        isAdding={isAdding}
        onAddClose={onAddClose}
      />
    </View>
  );
}

function ProviderTerminalHook({
  serverId,
  providerId,
}: {
  serverId: string;
  providerId: TerminalProviderId;
}) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsProviderSettings = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.terminalAgentHookProviders === true,
  );
  const { config, isLoading, patchConfig } = useDaemonConfig(serverId);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const value = supportsProviderSettings
    ? (config?.terminalAgentHooks?.[providerId] ?? config?.enableTerminalAgentHooks ?? false)
    : (config?.enableTerminalAgentHooks ?? false);

  const handleValueChange = useCallback(
    (nextValue: boolean) => {
      if (!config || !isConnected) return;
      setUpdateError(null);
      setIsUpdating(true);
      let patch: MutableDaemonConfigPatch;
      if (supportsProviderSettings) {
        patch = { terminalAgentHooks: { [providerId]: nextValue } };
      } else {
        // COMPAT(terminalAgentHookProviders): added in v0.2.0, remove after 2027-01-22.
        patch = { enableTerminalAgentHooks: nextValue };
      }
      void patchConfig(patch)
        .catch((error) => {
          setUpdateError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => setIsUpdating(false));
    },
    [config, isConnected, patchConfig, providerId, supportsProviderSettings],
  );
  const handleDismissUpdateError = useCallback(() => setUpdateError(null), []);

  return (
    <View style={styles.hookSection}>
      <Text style={settingsStyles.sectionHeaderTitle}>
        {t("settings.providers.terminal.activityTitle")}
      </Text>
      {updateError ? (
        <InlineAlert
          variant="error"
          title={t("settings.providers.terminal.updateError")}
          description={updateError}
          testID="provider-terminal-hook-error"
        >
          <Button variant="secondary" size="sm" onPress={handleDismissUpdateError}>
            {t("common.actions.dismiss")}
          </Button>
        </InlineAlert>
      ) : null}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {supportsProviderSettings
                ? t("settings.providers.terminal.activityLabel")
                : t("settings.providers.terminal.legacyActivityLabel")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {supportsProviderSettings
                ? t("settings.providers.terminal.activityHint")
                : t("settings.providers.terminal.legacyActivityHint")}
            </Text>
          </View>
          <Switch
            value={value}
            onValueChange={handleValueChange}
            disabled={!isConnected || isLoading || isUpdating || config == null}
            accessibilityLabel={t(
              supportsProviderSettings
                ? "settings.providers.terminal.activityLabel"
                : "settings.providers.terminal.legacyActivityLabel",
            )}
            testID={`terminal-agent-hook-${providerId}`}
          />
        </View>
      </View>
    </View>
  );
}

export function OtherTerminalProfilesSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config } = useDaemonConfig(serverId);
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const profiles = useMemo(
    () =>
      config ? filterTerminalProfiles(resolveTerminalProfiles(config.terminalProfiles), null) : [],
    [config],
  );
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.terminal.otherProfiles") }),
    [t],
  );
  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => {
    setIsAdding(false);
    setIsOpen(false);
  }, []);
  const handleAddOpen = useCallback(() => setIsAdding(true), []);
  const handleAddClose = useCallback(() => setIsAdding(false), []);
  const footer = useMemo(
    () => (
      <View style={styles.otherFooter}>
        <Button
          variant="default"
          size="sm"
          leftIcon={Plus}
          onPress={handleAddOpen}
          disabled={!isConnected || config == null}
          testID="other-terminal-profiles-add"
        >
          {t("settings.providers.terminal.addProfile")}
        </Button>
      </View>
    ),
    [config, handleAddOpen, isConnected, t],
  );

  return (
    <>
      <SettingsSection title={t("settings.providers.terminal.sectionTitle")}>
        <View style={settingsStyles.card}>
          <Pressable
            style={settingsStyles.row}
            onPress={handleOpen}
            accessibilityRole="button"
            testID="other-terminal-profiles-row"
          >
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.providers.terminal.otherProfiles")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.providers.terminal.otherProfilesHint", { count: profiles.length })}
              </Text>
            </View>
            <ThemedChevronRight uniProps={mutedIconProps} />
          </Pressable>
        </View>
      </SettingsSection>

      <AdaptiveModalSheet
        header={header}
        visible={isOpen}
        onClose={handleClose}
        footer={footer}
        testID="other-terminal-profiles-sheet"
      >
        <TerminalProfilesPanel
          serverId={serverId}
          providerId={null}
          isAdding={isAdding}
          onAddClose={handleAddClose}
        />
      </AdaptiveModalSheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  providerBody: {
    gap: theme.spacing[6],
  },
  hookSection: {
    gap: theme.spacing[2],
  },
  profileSection: {
    gap: theme.spacing[2],
  },
  profileRow: {
    gap: theme.spacing[3],
    minHeight: 56,
  },
  profileEditButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  otherFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
}));
