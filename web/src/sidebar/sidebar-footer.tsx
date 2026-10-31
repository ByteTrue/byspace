import { useCallback } from "react";
import { FolderPlus, Import, Server, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { openHostOverview } from "@/navigation/settings-navigation";
import { buildSettingsAddHostRoute, buildSettingsRoute } from "@/utils/host-routes";
import { router } from "expo-router";
import { Shortcut } from "~/components/shortcut";
import { SidebarFooter as SidebarFooterFrame } from "~/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { SidebarHelpMenu } from "~/sidebar/help-menu";
import { SidebarHostPicker } from "~/sidebar/host-picker";
import { SidebarIconButton } from "~/sidebar/sidebar-icon-button";

/** packages/app's SidebarFooter: Add project on the left, hosts, import, help and settings on the right. */
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
          <button
            type="button"
            onClick={run(() => openAddProject())}
            aria-label={t("sidebar.actions.addProject")}
            data-testid="sidebar-add-project"
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
          >
            <FolderPlus className="size-4 shrink-0" />
            <span className="truncate">{t("sidebar.actions.addProject")}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("sidebar.actions.addProject")}
          <Shortcut chord={newAgentKeys} />
        </TooltipContent>
      </Tooltip>
      <SidebarHostPicker onAddHost={addHost} onOpenHostSettings={openHostSettings}>
        <SidebarIconButton
          label={t("sidebar.actions.hosts")}
          tooltipSide="top"
          data-testid="sidebar-hosts-trigger"
        >
          <Server />
        </SidebarIconButton>
      </SidebarHostPicker>
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
