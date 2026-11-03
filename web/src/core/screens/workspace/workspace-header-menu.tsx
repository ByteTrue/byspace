// Port of archive/expo-app:packages/app/src/screens/workspace/workspace-header-menu.tsx: the workspace "..."
// menu in the header, and its phone version that also creates agents and terminals.
import { useCallback, useMemo } from "react";
import { Copy, Ellipsis, Import as ImportIcon, Settings, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { router } from "~/app/navigation";
import type { TerminalProfile } from "@bytetrue/protocol/messages";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@bytetrue/protocol/terminal-profiles";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { Button } from "~/components/ui/button";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";

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
        data-testid="workspace-header-copy-path"
        disabled={copyPathDisabled}
        onSelect={onCopyWorkspacePath}
      >
        {COPY_ICON}
        {t("workspace.header.actions.copyPath")}
      </DropdownMenuItem>
      {currentBranchName ? (
        <DropdownMenuItem
          data-testid="workspace-header-copy-branch-name"
          onSelect={onCopyBranchName}
        >
          {COPY_ICON}
          {t("workspace.header.actions.copyBranchName")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        data-testid="workspace-header-import-agent"
        disabled={importAgentDisabled}
        onSelect={onOpenImportSheet}
      >
        {IMPORT_ICON}
        {t("workspace.header.actions.importSession")}
      </DropdownMenuItem>
      {showWorkspaceSetup ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="workspace-header-show-setup" onSelect={onOpenSetupTab}>
            {SETTINGS_ICON}
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
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="workspace-header-menu-trigger"
        aria-label={t("workspace.header.actions.workspaceActions")}
      >
        <Ellipsis className="text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
  );
}

export function WorkspaceHeaderMenuDesktop(props: WorkspaceHeaderWorkspaceActions) {
  return (
    <DropdownMenu>
      <HeaderMenuTrigger />
      <DropdownMenuContent
        align="start"
        data-testid="workspace-header-menu"
        className="w-[220px]"
        onCloseAutoFocus={keepFocusElsewhere}
      >
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
    <DropdownMenuItem disabled={disabled} onSelect={handleSelect}>
      {leading}
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
    <DropdownMenu>
      <HeaderMenuTrigger />
      <DropdownMenuContent
        align="start"
        data-testid="workspace-header-menu"
        className="w-[220px]"
        onCloseAutoFocus={keepFocusElsewhere}
      >
        <DropdownMenuItem data-testid="workspace-header-new-agent" onSelect={onCreateDraftTab}>
          {NEW_AGENT_ICON}
          {t("workspace.header.actions.newAgent")}
        </DropdownMenuItem>
        <WorkspaceHeaderWorkspaceActionItems {...workspaceActions} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("workspace.tabs.actions.terminalProfilesMenu")}</DropdownMenuLabel>
        <DropdownMenuItem
          data-testid="workspace-header-new-terminal"
          disabled={createTerminalDisabled}
          onSelect={onCreateTerminal}
        >
          {NEW_TERMINAL_ICON}
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
          data-testid="workspace-header-edit-terminal-profiles"
          onSelect={handleEditProfiles}
        >
          {t("workspace.tabs.actions.editTerminalProfiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
