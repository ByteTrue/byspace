import { useCallback } from "react";
import { ArrowDownAZ } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import {
  SIDEBAR_NAV_TEST_IDS,
  useSidebarHeaderNavEntries,
} from "@/sidebar-nav/use-sidebar-nav-entries";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import { sortProjectsByRules } from "@/utils/sidebar-sort-projects";
import { SidebarDisplayPreferencesMenu } from "~/sidebar/display-preferences-menu";
import { SidebarIconButton } from "~/sidebar/sidebar-icon-button";

function SortProjectsButton() {
  const { t } = useTranslation();
  const { allProjects, workspaceEntriesByKey } = useSidebarModel();
  const getProjectOrder = useSidebarOrderStore((state) => state.getProjectOrder);
  const setProjectOrder = useSidebarOrderStore((state) => state.setProjectOrder);
  const sort = useCallback(() => {
    if (allProjects.length === 0) return;
    const sortedKeys = sortProjectsByRules(allProjects, workspaceEntriesByKey).map(
      (project) => project.viewKey,
    );
    const currentOrder = getProjectOrder();
    if (!hasVisibleOrderChanged({ currentOrder, reorderedVisibleKeys: sortedKeys })) return;
    setProjectOrder(mergeWithRemainder({ currentOrder, reorderedVisibleKeys: sortedKeys }));
  }, [allProjects, getProjectOrder, setProjectOrder, workspaceEntriesByKey]);
  return (
    <SidebarIconButton
      label={t("sidebar.sortProjects.label", { defaultValue: "Sort projects" })}
      onClick={sort}
      data-testid="sidebar-sort-projects-button"
      className="[&_svg]:size-3.5"
    >
      <ArrowDownAZ />
    </SidebarIconButton>
  );
}

type HeaderEntry = ReturnType<typeof useSidebarHeaderNavEntries>[number];

function HeaderNavButton({
  entry,
  onBeforeNavigate,
}: {
  entry: HeaderEntry;
  onBeforeNavigate?: () => void;
}) {
  const handleClick = useCallback(() => {
    onBeforeNavigate?.();
    entry.onSelect();
  }, [entry, onBeforeNavigate]);
  const Icon = entry.icon;
  return (
    <SidebarIconButton
      label={entry.label}
      shortcutKeys={entry.shortcutKeys}
      active={entry.isActive}
      onClick={handleClick}
      data-testid={SIDEBAR_NAV_TEST_IDS[entry.id]}
      className="[&_svg]:size-3.5"
    >
      <Icon />
    </SidebarIconButton>
  );
}

/**
 * The Expo app's WorkspacesSectionHeader: the "Workspaces" title with New workspace and History,
 * plus sorting and display preferences once there is a list to control.
 */
export function WorkspacesSectionHeader({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const headerEntries = useSidebarHeaderNavEntries();
  const { allProjects } = useSidebarModel();
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const hasListControls = allProjects.length > 0 || hasActiveHostFilter;
  return (
    <div className="flex shrink-0 items-center gap-2 pt-3 pr-3 pb-1.5 pl-4">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
        Workspaces
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {headerEntries.map((entry) => (
          <HeaderNavButton key={entry.id} entry={entry} onBeforeNavigate={onBeforeNavigate} />
        ))}
        {hasListControls ? (
          <>
            <SortProjectsButton />
            <SidebarDisplayPreferencesMenu />
          </>
        ) : null}
      </span>
    </div>
  );
}
