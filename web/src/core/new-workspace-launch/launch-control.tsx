// Port of archive/expo-app:packages/app/src/new-workspace-launch/launch-control.tsx: what New workspace submits
// to — the chat agent or a terminal (blank or a profile). Same props, except the trigger takes the
// meta row's badge classes instead of a React Native style.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "~/app/navigation";
import { ChevronDown, MessageCircle, SquareTerminal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    <DropdownMenuItem
      testID={`new-workspace-launch-option-${profile.id}`}
      onSelect={handleSelect}
      selected={selected}
      leading={leading}
    >
      {profile.name}{" "}
      <span className="font-mono text-xs text-muted-foreground">{commandPreview}</span>
    </DropdownMenuItem>
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
            <DropdownMenuTrigger
              testID="new-workspace-launch-trigger"
              disabled={disabled}
              className={badgeClassName}
              accessibilityLabel={t("newWorkspace.tooltips.launch")}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                <TriggerIcon target={target} profile={selectedProfile} />
              </span>
              <span className="min-w-0 shrink truncate text-sm text-muted-foreground">
                {triggerLabel}
                {selectedProfile ? (
                  <span className="text-muted-foreground"> {selectedProfile.name}</span>
                ) : null}
              </span>
              <ChevronDown size={ICON_SIZE.sm} className="shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {t("newWorkspace.tooltips.launch")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        offset={8}
        width={260}
        sheetTitle={t("newWorkspace.launch.title")}
        testID="new-workspace-launch-menu"
      >
        {/* Chat has no group label of its own; Terminal keeps its label because that grouping is
            what stops a profile named Codex reading as a chat Codex agent. */}
        <DropdownMenuItem
          testID="new-workspace-launch-option-chat"
          onSelect={selectChat}
          selected={target.kind === "chat"}
          leading={chatIcon}
        >
          {t("newWorkspace.launch.chat")}
        </DropdownMenuItem>
        <DropdownMenuLabel>{t("newWorkspace.launch.terminal")}</DropdownMenuLabel>
        <DropdownMenuItem
          testID="new-workspace-launch-option-blank"
          onSelect={selectBlankTerminal}
          selected={isBlankTerminalTarget(target)}
          leading={blankTerminalIcon}
        >
          {t("newWorkspace.launch.terminal")}
        </DropdownMenuItem>
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
          testID="new-workspace-launch-manage-profiles"
          onSelect={openProfileSettings}
          muted
        >
          {t("newWorkspace.launch.manageProfiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
