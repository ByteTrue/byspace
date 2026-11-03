import { useCallback, useRef, useState } from "react";
import { FolderPlus, Import, Server, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HostPicker } from "@/components/hosts/host-picker";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { openHostOverview } from "@/navigation/settings-navigation";
import { useHosts } from "@/runtime/host-runtime";
import { buildSettingsAddHostRoute, buildSettingsRoute } from "@/utils/host-routes";
import { router } from "~/app/navigation";
import { Shortcut } from "~/components/shortcut";
import { SidebarFooter as SidebarFooterFrame } from "~/components/ui/sidebar";
import { SidebarMenuButton } from "~/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { SidebarHelpMenu } from "~/sidebar/help-menu";
import { SidebarIconButton } from "~/sidebar/sidebar-icon-button";

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

/** The Expo app's SidebarHostsButton: the shared host picker, opening upwards from the footer. */
function SidebarHostsButton({
  onAddHost,
  onOpenHostSettings,
}: {
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const handleOpen = useCallback(() => setIsOpen(true), []);
  return (
    <HostPicker
      hosts={hosts}
      value=""
      onSelect={onOpenHostSettings}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopPlacement="top-start"
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      <SidebarIconButton
        ref={triggerRef}
        label={t("sidebar.actions.hosts")}
        tooltipSide="top"
        onClick={handleOpen}
        data-testid="sidebar-hosts-trigger"
      >
        <Server />
      </SidebarIconButton>
    </HostPicker>
  );
}

/** The Expo app's SidebarFooter: Add project on the left, hosts, import, help and settings on the right. */
export function SidebarFooter({
  onBeforeNavigate,
  onImportSession,
}: {
  onBeforeNavigate?: () => void;
  onImportSession: () => void;
}) {
  const { t } = useTranslation();
  const openAddProject = useOpenAddProject();
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsKeys = useShortcutKeys("toggle-settings");
  const run = (action: () => void) => () => {
    onBeforeNavigate?.();
    action();
  };
  const addHost = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [onBeforeNavigate]);
  const openHostSettings = useCallback(
    (serverId: string) => {
      onBeforeNavigate?.();
      openHostOverview(serverId);
    },
    [onBeforeNavigate],
  );
  return (
    <SidebarFooterFrame className="flex-row items-center gap-2 px-2 py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuButton
            onClick={run(() => openAddProject())}
            aria-label={t("sidebar.actions.addProject")}
            data-testid="sidebar-add-project"
            className="min-w-0 flex-1"
          >
            <FolderPlus />
            <span>{t("sidebar.actions.addProject")}</span>
          </SidebarMenuButton>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("sidebar.actions.addProject")}
          <Shortcut chord={newAgentKeys} />
        </TooltipContent>
      </Tooltip>
      <SidebarHostsButton onAddHost={addHost} onOpenHostSettings={openHostSettings} />
      <SidebarIconButton
        label={t("importSession.title")}
        tooltipSide="top"
        onClick={onImportSession}
        data-testid="sidebar-import-session"
      >
        <Import />
      </SidebarIconButton>
      <SidebarHelpMenu />
      <SidebarIconButton
        label={t("sidebar.actions.settings")}
        shortcutKeys={settingsKeys}
        tooltipSide="top"
        onClick={run(() => router.push(buildSettingsRoute()))}
        data-testid="sidebar-settings"
      >
        <Settings />
      </SidebarIconButton>
    </SidebarFooterFrame>
  );
}
