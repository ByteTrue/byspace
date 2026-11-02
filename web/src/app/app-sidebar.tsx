import { useCallback, useMemo } from "react";
import { GitBranch, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useIsCompactFormFactor, useMacTrafficLightInset } from "@/constants/layout";
import { SidebarCalloutViewport } from "@/contexts/sidebar-callout-context";
import { useImportSession } from "@/hooks/use-import-session";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { usePanelStore } from "@/stores/panel-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { cn } from "cn";
import { SidebarToggle } from "~/app/sidebar-toggle";
import { Button } from "~/components/ui/button";
import { SidebarContent, SidebarHeader } from "~/components/ui/sidebar";
import { SidebarListSkeleton } from "~/sidebar/list-parts";
import { SidebarNavRows } from "~/sidebar/nav-menu";
import { SidebarFooter } from "~/sidebar/sidebar-footer";
import { SidebarWorkspaceList } from "~/sidebar/workspace-list";

const DEV_BUILD_LABEL = process.env.EXPO_PUBLIC_BYSPACE_DEV_BUILD_LABEL?.trim() || null;

/** packages/app's LeftSidebar, inside shadcn's inset Sidebar: header, workspace list, callouts, footer. */
export function AppSidebar() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  // On a phone the sidebar is a sheet over the page, so it gets out of the way of any navigation.
  const closeOnNavigate = isCompact ? showMobileAgent : undefined;
  const trafficLightInset = useMacTrafficLightInset();
  const {
    projects,
    hasProjectsBeforeFilter,
    workspaceEntriesByKey,
    isInitialLoad,
    workspaceGroups,
    projectIconTargets,
    pinnedGroups,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const openAddProject = useOpenAddProject();
  const { open: openImportSession, sheet: importSessionSheet } = useImportSession();
  const addProject = useCallback(() => {
    closeOnNavigate?.();
    openAddProject();
  }, [closeOnNavigate, openAddProject]);
  // As packages/app's sidebar: on a phone the drawer closes before the sheet opens.
  const importSession = useCallback(() => {
    closeOnNavigate?.();
    openImportSession();
  }, [closeOnNavigate, openImportSession]);
  const headerStyle = useMemo(
    () => (trafficLightInset > 0 ? { paddingLeft: 12 + trafficLightInset } : undefined),
    [trafficLightInset],
  );

  return (
    <>
      <SidebarHeader
        data-wails-drag="true"
        // Desktop: packages/app's 35px corner row (HEADER_INNER_HEIGHT minus the hairline it pairs
        // with). Compact: its header band, 8px above and below a 32px close button, over a hairline.
        className={cn(
          "shrink-0 flex-row items-center gap-1",
          isCompact ? "border-b border-sidebar-border px-2 py-2" : "h-[35px] px-3 py-0",
        )}
        style={headerStyle}
      >
        {isCompact ? null : <SidebarToggle host="sidebar" />}
        {isCompact ? (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto rounded-lg text-muted-foreground"
            onClick={showMobileAgent}
            aria-label={t("sidebar.actions.closeSidebar")}
            data-testid="sidebar-close"
          >
            <X />
          </Button>
        ) : null}
      </SidebarHeader>
      {/* Pinned above the list, as packages/app's header was: a wheel over them scrolls nothing,
          and they stay in reach when the list is scrolled. */}
      <div className="shrink-0 pt-0.5">
        <SidebarNavRows onBeforeNavigate={closeOnNavigate} />
      </div>
      {/* overflow-x hidden as packages/app's list: it scrolls up and down only. */}
      <SidebarContent
        className="gap-0 overflow-x-hidden pb-4"
        data-testid="sidebar-project-workspace-list-scroll"
      >
        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarListSkeleton />
        ) : (
          <SidebarWorkspaceList
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            pinnedGroups={pinnedGroups}
            projects={projects}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            shortcutIndexByWorkspaceKey={shortcutModel.shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            onWorkspacePress={closeOnNavigate}
            onAddProject={addProject}
            onImportSession={importSession}
          />
        )}
      </SidebarContent>
      {/* As packages/app's MobileSidebar, the phone panel has no callouts and no build label. */}
      {isCompact ? null : (
        <div className="shrink-0 empty:hidden">
          <SidebarCalloutViewport />
        </div>
      )}
      {DEV_BUILD_LABEL && !isCompact ? (
        <div className="flex shrink-0 px-2 pb-1.5">
          <span
            className="flex min-w-0 items-center gap-1 rounded-[4px] bg-sidebar-accent px-1.5 py-0.5 text-xs text-muted-foreground"
            data-testid="dev-build-label"
            aria-label={`Development build: ${DEV_BUILD_LABEL}`}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{DEV_BUILD_LABEL}</span>
          </span>
        </div>
      ) : null}
      <SidebarFooter onBeforeNavigate={closeOnNavigate} onImportSession={importSession} />
      {importSessionSheet}
    </>
  );
}
