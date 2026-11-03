// Port of archive/expo-app:packages/app/src/new-workspace-launch/launch-control.tsx: what New workspace submits
// to — the chat agent or a terminal (blank or a profile). Same props, except the trigger takes the
// meta row's badge classes instead of a React Native style.
import { Button } from "~/components/ui/button";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "~/app/navigation";
import { ChevronDown, MessageCircle, SquareTerminal } from "lucide-react";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { ICON_SIZE } from "@/styles/theme";
import {
  formatResolvedCommand,
  getTerminalProfileIcon,
  substitutePrompt,
} from "@bytetrue/protocol/terminal-profiles";
import type { TerminalProfile } from "@bytetrue/protocol/messages";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import {
  BLANK_TERMINAL_PROFILE_ID,
  CHAT_LAUNCH_TARGET,
  isBlankTerminalTarget,
  resolveLaunchProfile,
  terminalLaunchTarget,
  type LaunchTarget,
} from "@/new-workspace-launch/target";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";

const chatIcon = <MessageCircle size={ICON_SIZE.sm} className="text-muted-foreground" />;
const blankTerminalIcon = <SquareTerminal size={ICON_SIZE.sm} className="text-muted-foreground" />;

function LaunchProfileMenuItem({
  profile,
  selected,
  onSelect,
}: {
  profile: TerminalProfile;
  selected: boolean;
  onSelect: (profileId: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onSelect(profile.id), [onSelect, profile.id]);
  const leading = useMemo(
    () => <TerminalProfileIcon iconKey={getTerminalProfileIcon(profile)} />,
    [profile],
  );
  // What the profile runs before any prompt is typed, inline after the name.
  const commandPreview = useMemo(
    () => formatResolvedCommand(substitutePrompt(profile, "")),
    [profile],
  );
  return (
    <DropdownMenuCheckboxItem
      checked={selected}
      data-testid={`new-workspace-launch-option-${profile.id}`}
      onSelect={handleSelect}
    >
      {leading}
      {profile.name}{" "}
      <span className="font-mono text-xs text-muted-foreground">{commandPreview}</span>
    </DropdownMenuCheckboxItem>
  );
}

export interface LaunchControlProps {
  serverId: string;
  target: LaunchTarget;
  onChange: (target: LaunchTarget) => void;
  profiles: readonly TerminalProfile[];
  disabled?: boolean;
  /** The meta row's badge classes, so this chip matches the project, host and branch chips. */
  badgeClassName: string;
}

function TriggerIcon({
  target,
  profile,
}: {
  target: LaunchTarget;
  profile: TerminalProfile | null;
}): ReactElement {
  if (target.kind === "chat") {
    return <MessageCircle size={ICON_SIZE.sm} className="text-muted-foreground" />;
  }
  if (profile) {
    return <TerminalProfileIcon iconKey={getTerminalProfileIcon(profile)} />;
  }
  return <SquareTerminal size={ICON_SIZE.sm} className="text-muted-foreground" />;
}

export function LaunchControl({
  serverId,
  target,
  onChange,
  profiles,
  disabled = false,
  badgeClassName,
}: LaunchControlProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const selectedProfile = useMemo(() => resolveLaunchProfile(target, profiles), [target, profiles]);
  // Leading with the noun keeps a profile named "Codex" from reading as a chat Codex agent.
  const triggerLabel =
    target.kind === "chat" ? t("newWorkspace.launch.chat") : t("newWorkspace.launch.terminal");

  const selectChat = useCallback(() => onChange(CHAT_LAUNCH_TARGET), [onChange]);
  const selectBlankTerminal = useCallback(
    () => onChange(terminalLaunchTarget(BLANK_TERMINAL_PROFILE_ID)),
    [onChange],
  );
  const selectTerminalProfile = useCallback(
    (profileId: string) => onChange(terminalLaunchTarget(profileId)),
    [onChange],
  );
  const openProfileSettings = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "agents"));
  }, [router, serverId]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* Suppressed while the menu is open so the two surfaces never overlap. */}
      <Tooltip delayDuration={300} open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <span className="flex min-w-0">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                data-testid="new-workspace-launch-trigger"
                disabled={disabled}
                aria-label={t("newWorkspace.tooltips.launch")}
                className={badgeClassName}
              >
                <TriggerIcon target={target} profile={selectedProfile} />
                <span className="min-w-0 shrink truncate">
                  {selectedProfile ? `${triggerLabel} ${selectedProfile.name}` : triggerLabel}
                </span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {t("newWorkspace.tooltips.launch")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        data-testid="new-workspace-launch-menu"
        className="w-[260px]"
        onCloseAutoFocus={keepFocusElsewhere}
      >
        {/* Chat has no group label of its own; Terminal keeps its label because that grouping is
            what stops a profile named Codex reading as a chat Codex agent. */}
        <DropdownMenuCheckboxItem
          checked={target.kind === "chat"}
          data-testid="new-workspace-launch-option-chat"
          onSelect={selectChat}
        >
          {chatIcon}
          {t("newWorkspace.launch.chat")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuLabel>{t("newWorkspace.launch.terminal")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={isBlankTerminalTarget(target)}
          data-testid="new-workspace-launch-option-blank"
          onSelect={selectBlankTerminal}
        >
          {blankTerminalIcon}
          {t("newWorkspace.launch.terminal")}
        </DropdownMenuCheckboxItem>
        {profiles.map((profile) => (
          <LaunchProfileMenuItem
            key={profile.id}
            profile={profile}
            selected={selectedProfile?.id === profile.id}
            onSelect={selectTerminalProfile}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="new-workspace-launch-manage-profiles"
          onSelect={openProfileSettings}
          className="text-muted-foreground"
        >
          {t("newWorkspace.launch.manageProfiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
