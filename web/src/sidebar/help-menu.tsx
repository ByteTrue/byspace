import { useCallback, useState } from "react";
import { Activity, CircleHelp, Gift, Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openChangelog } from "@/changelog/open-changelog";
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useSessionStore } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import { resolveAppVersion } from "@/utils/app-version";
import { formatVersionWithPrefix } from "@/utils/format-version";
import { openExternalUrl } from "@/utils/open-external-url";
import { DiscordIcon, ForgeIcon } from "~/components/forge-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SidebarIconButton } from "~/sidebar/sidebar-icon-button";

const DISCORD_URL = "https://discord.gg/jz8T2uahpH";
const GITHUB_ISSUE_URL = "https://github.com/ByteTrue/byspace/issues/new";

function VersionRow({
  label,
  version,
  testId,
}: {
  label: string;
  version: string;
  testId: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 text-xs leading-[normal] text-muted-foreground"
      data-testid={testId}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0">{version}</span>
    </div>
  );
}

function HostVersionRow({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );
  return (
    <VersionRow
      label={host.label}
      version={isConnected ? formatVersionWithPrefix(daemonVersion) : t("settings.about.offline")}
      testId={`sidebar-help-host-version-${host.serverId}`}
    />
  );
}

function openDiscord() {
  void openExternalUrl(DISCORD_URL);
}

function openGithubIssue() {
  void openExternalUrl(GITHUB_ISSUE_URL);
}

/** The Expo app's SidebarHelpMenu: shortcuts, what's new, diagnostics, where to report, and versions. */
export function SidebarHelpMenu() {
  const { t } = useTranslation();
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const openAppDiagnostic = useAppDiagnosticStore((state) => state.open);
  const setShortcutsDialogOpen = useKeyboardShortcutsStore((state) => state.setShortcutsDialogOpen);
  const hosts = useHosts();
  const [open, setOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsDialogOpen(true), [setShortcutsDialogOpen]);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarIconButton
          fill={false}
          label={t("sidebar.help.trigger")}
          tooltipSide="top"
          data-testid="sidebar-help"
        >
          <CircleHelp />
        </SidebarIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={8}
        className="menu-icons-sm w-70"
        data-testid="sidebar-help-menu"
      >
        <DropdownMenuLabel>{t("sidebar.help.sectionHelp")}</DropdownMenuLabel>
        {shortcutsAvailable ? (
          <DropdownMenuItem onSelect={openShortcuts} data-testid="sidebar-help-shortcuts">
            <Keyboard />
            {t("sidebar.help.shortcuts")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={openChangelog} data-testid="sidebar-help-changelog">
          <Gift />
          {t("sidebar.help.whatsNew")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openAppDiagnostic} data-testid="sidebar-help-diagnostics">
          <Activity />
          {t("sidebar.help.diagnostics")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("sidebar.help.reportIssue")}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={openDiscord} data-testid="sidebar-help-discord">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <DiscordIcon className="size-3.5" />
          </span>
          {t("sidebar.help.discord")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openGithubIssue} data-testid="sidebar-help-github">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <ForgeIcon iconKind="github" className="size-3.5" />
          </span>
          {t("sidebar.help.github")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* The Expo app's versionList: the version rows as one block, 4px apart, 8px above and below. */}
        <div className="flex flex-col gap-1 py-2">
          <VersionRow
            label={t("sidebar.help.appName")}
            version={formatVersionWithPrefix(resolveAppVersion())}
            testId="sidebar-help-version"
          />
          {hosts.map((host) => (
            <HostVersionRow key={host.serverId} host={host} />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
