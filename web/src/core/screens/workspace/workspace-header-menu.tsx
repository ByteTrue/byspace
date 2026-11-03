// Port of packages/app/src/screens/workspace/workspace-header-menu.tsx: the workspace "..."
// menu in the header, and its phone version that also creates agents and terminals.
import { useCallback, useMemo } from "react";
import { Copy, Ellipsis, Import as ImportIcon, Settings, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import type { TerminalProfile } from "@bytetrue/protocol/messages";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@bytetrue/protocol/terminal-profiles";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  iconButtonChromeClassName,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";

const COPY_ICON = <Copy />;
const IMPORT_ICON = <ImportIcon />;
const SETTINGS_ICON = <Settings />;
const NEW_AGENT_ICON = <SquarePen />;
const NEW_TERMINAL_ICON = <TerminalProfileIcon iconKey={undefined} size={16} />;

export interface WorkspaceHeaderWorkspaceActions {
  currentBranchName: string | null;
  showWorkspaceSetup: boolean;
  importAgentDisabled: boolean;
  copyPathDisabled: boolean;
  onOpenImportSheet: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
}

function WorkspaceHeaderWorkspaceActionItems({
  currentBranchName,
  showWorkspaceSetup,
  importAgentDisabled,
  copyPathDisabled,
  onOpenImportSheet,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
}: WorkspaceHeaderWorkspaceActions) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem
        testID="workspace-header-copy-path"
        leading={COPY_ICON}
        disabled={copyPathDisabled}
        onSelect={onCopyWorkspacePath}
      >
        {t("workspace.header.actions.copyPath")}
      </DropdownMenuItem>
      {currentBranchName ? (
        <DropdownMenuItem
          testID="workspace-header-copy-branch-name"
          leading={COPY_ICON}
          onSelect={onCopyBranchName}
        >
          {t("workspace.header.actions.copyBranchName")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        testID="workspace-header-import-agent"
        leading={IMPORT_ICON}
        disabled={importAgentDisabled}
        onSelect={onOpenImportSheet}
      >
        {t("workspace.header.actions.importSession")}
      </DropdownMenuItem>
      {showWorkspaceSetup ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            testID="workspace-header-show-setup"
            leading={SETTINGS_ICON}
            onSelect={onOpenSetupTab}
          >
            {t("workspace.header.actions.showSetup")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

function HeaderMenuTrigger() {
  const { t } = useTranslation();
  return (
    <DropdownMenuTrigger
      testID="workspace-header-menu-trigger"
      accessibilityLabel={t("workspace.header.actions.workspaceActions")}
      className={iconButtonChromeClassName({ size: "large" })}
    >
      <Ellipsis size={iconButtonChromeGlyphSize("large")} className="text-extra-muted-foreground" />
    </DropdownMenuTrigger>
  );
}

export function WorkspaceHeaderMenuDesktop(props: WorkspaceHeaderWorkspaceActions) {
  return (
    <DropdownMenu>
      <HeaderMenuTrigger />
      <DropdownMenuContent align="start" width={220} testID="workspace-header-menu">
        <WorkspaceHeaderWorkspaceActionItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderMenuProfileItem({
  profile,
  disabled,
  onCreateTerminalWithProfile,
}: {
  profile: TerminalProfile;
  disabled: boolean;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
}) {
  const handleSelect = useCallback(
    () => onCreateTerminalWithProfile(profile),
    [onCreateTerminalWithProfile, profile],
  );
  const leading = useMemo(
    () => <TerminalProfileIcon iconKey={getTerminalProfileIcon(profile)} size={16} />,
    [profile],
  );
  return (
    <DropdownMenuItem leading={leading} disabled={disabled} onSelect={handleSelect}>
      {profile.name}
    </DropdownMenuItem>
  );
}

export interface WorkspaceHeaderMenuMobileProps extends WorkspaceHeaderWorkspaceActions {
  normalizedServerId: string;
  createTerminalDisabled: boolean;
  onCreateDraftTab: () => void;
  onCreateTerminal: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
}

export function WorkspaceHeaderMenuMobile({
  normalizedServerId,
  createTerminalDisabled,
  onCreateDraftTab,
  onCreateTerminal,
  onCreateTerminalWithProfile,
  ...workspaceActions
}: WorkspaceHeaderMenuMobileProps) {
  const { t } = useTranslation();
  const { config } = useDaemonConfig(normalizedServerId);
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );
  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "agents"));
  }, [normalizedServerId]);
  return (
    <DropdownMenu compactMode="sheet">
      <HeaderMenuTrigger />
      <DropdownMenuContent
        align="start"
        width={220}
        testID="workspace-header-menu"
        sheetTitle={t("workspace.header.actions.workspaceActions")}
      >
        <DropdownMenuItem
          testID="workspace-header-new-agent"
          leading={NEW_AGENT_ICON}
          onSelect={onCreateDraftTab}
        >
          {t("workspace.header.actions.newAgent")}
        </DropdownMenuItem>
        <WorkspaceHeaderWorkspaceActionItems {...workspaceActions} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("workspace.tabs.actions.terminalProfilesMenu")}</DropdownMenuLabel>
        <DropdownMenuItem
          testID="workspace-header-new-terminal"
          leading={NEW_TERMINAL_ICON}
          disabled={createTerminalDisabled}
          onSelect={onCreateTerminal}
        >
          {t("workspace.header.actions.newTerminal")}
        </DropdownMenuItem>
        {profiles.map((profile) => (
          <HeaderMenuProfileItem
            key={profile.id}
            profile={profile}
            disabled={createTerminalDisabled}
            onCreateTerminalWithProfile={onCreateTerminalWithProfile}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          testID="workspace-header-edit-terminal-profiles"
          onSelect={handleEditProfiles}
        >
          {t("workspace.tabs.actions.editTerminalProfiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
