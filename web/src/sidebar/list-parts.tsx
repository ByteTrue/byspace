import { useCallback } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Import, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";

/** "Show more / Show less" under a group longer than 20 rows. */
export function ShowMoreRow({
  expanded,
  onToggle,
  testId,
}: {
  expanded: boolean;
  onToggle: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  const label = t(
    expanded ? "sidebar.workspace.actions.showLess" : "sidebar.workspace.actions.showMore",
  );
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      data-testid={testId}
      className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      <span className="flex size-4 items-center justify-center">
        <Icon className="size-3.5" />
      </span>
      {label}
    </button>
  );
}

export function PinnedSectionHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      data-testid="sidebar-pinned-section-header"
      className="group/pinned flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-sidebar-foreground"
    >
      {t("sidebar.pinned.title")}
      <Chevron className="size-3 opacity-0 group-hover/pinned:opacity-100" />
    </button>
  );
}

export function SidebarFilterEmptyState() {
  const { t } = useTranslation();
  const clearProjectFilters = useSidebarViewStore((state) => state.clearProjectFilters);
  const clearLabelFilter = useSidebarViewStore((state) => state.clearLabelFilter);
  const clearFilters = useCallback(() => {
    clearProjectFilters();
    clearLabelFilter();
  }, [clearLabelFilter, clearProjectFilters]);
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-3">
      <p className="text-sm font-medium">{t("sidebar.filterEmpty.title")}</p>
      <p className="text-xs text-muted-foreground">{t("sidebar.filterEmpty.description")}</p>
      <Button variant="ghost" size="sm" className="-ml-2" onClick={clearFilters}>
        {t("sidebar.filterEmpty.clear")}
      </Button>
    </div>
  );
}

export function SidebarProjectEmptyState({
  onAddProject,
  onImportSession,
}: {
  onAddProject?: () => void;
  onImportSession?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-start gap-0.5 px-2 py-2"
      data-testid="sidebar-project-empty-state"
    >
      <Button variant="ghost" size="sm" onClick={onAddProject}>
        <Plus />
        {t("sidebar.actions.addProject")}
      </Button>
      <Button variant="ghost" size="sm" onClick={onImportSession}>
        <Import />
        {t("importSession.title")}
      </Button>
    </div>
  );
}

const SKELETON_SECTIONS = [
  { key: "first", style: { opacity: 1 } },
  { key: "second", style: { opacity: 0.7 } },
  { key: "third", style: { opacity: 0.45 } },
];

/** First-load placeholder: three fading project groups (the Expo app's SidebarAgentListSkeleton). */
export function SidebarListSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-2" data-testid="sidebar-agent-list-skeleton">
      {SKELETON_SECTIONS.map((section) => (
        <div key={section.key} className="flex flex-col gap-2" style={section.style}>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}
