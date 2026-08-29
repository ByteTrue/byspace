import React, { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  useSidebarWorkspacesList,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { hasActiveSidebarLabelFilter, useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection, type SidebarProjectedProject } from "./sidebar-projection";
import { filterWorkspacesByLabels } from "./sidebar-labels";
import { filterWorkspacesByProjects, resolveActiveProjectFilters } from "./sidebar-project-filter";
import {
  hasAuthoritativeWorkspaceLabelCatalog,
  useWorkspaceLabelProjection,
} from "@/workspace-labels";

interface SidebarModel extends Omit<SidebarWorkspacesListResult, "projects"> {
  projects: SidebarProjectedProject[];
  needsAttentionWorkspaceCount: number;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  shortcutModel: SidebarShortcutModel;
  pinnedGroups: PinnedSidebarGroups;
  /**
   * Every project the sidebar could show, before any filter narrows it.
   *
   * `projects` is the FILTERED list. A surface that offers a filter picker must read this one, or
   * narrowing the filter deletes the rows that would undo it.
   */
  allProjects: SidebarProjectEntry[];
  /** The project filter as it is actually being applied — see `resolveActiveProjectFilters`. */
  resolvedProjectFilters: readonly string[];
  hasProjectsBeforeFilter: boolean;
}

const SidebarModelContext = createContext<SidebarModel | null>(null);

export function SidebarModelProvider({
  active: _active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const list = useSidebarWorkspacesList();
  const attentionOnly = useSidebarViewStore((state) => state.attentionOnly);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const reconcileLabelFilter = useSidebarViewStore((state) => state.reconcileLabelFilter);
  const { hosts: labelHosts } = useWorkspaceLabelProjection();
  const collapsedPinned = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const pinnedWorkspaceOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);

  // Reconcile the persisted filter against the live catalog: a label that has been deleted
  // anywhere is not a label anymore. Unlabelled survives because it never names a label.
  const availableLabelNames = useMemo(
    () => labelHosts.flatMap((host) => host.labels.map((label) => label.name)),
    [labelHosts],
  );
  const hasAuthoritativeLabelCatalog = useMemo(
    () => hasAuthoritativeWorkspaceLabelCatalog(labelHosts),
    [labelHosts],
  );
  useEffect(() => {
    if (hasAuthoritativeLabelCatalog) {
      reconcileLabelFilter(availableLabelNames);
    }
  }, [availableLabelNames, hasAuthoritativeLabelCatalog, reconcileLabelFilter]);
  const hasActiveLabelFilter = hasActiveSidebarLabelFilter(labelFilter);

  const resolvedProjectFilters = useMemo(
    () =>
      resolveActiveProjectFilters(
        projectFilters,
        new Set(list.projects.map((project) => project.projectKey)),
      ),
    [projectFilters, list.projects],
  );
  const hasActiveProjectFilter = resolvedProjectFilters.length > 0;
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(list.workspacePlacements, true);
  const filteredWorkspaceEntriesByKey = useMemo(() => {
    const byProject = filterWorkspacesByProjects({
      workspaces: [...workspaceEntriesByKey.values()],
      projectFilters: resolvedProjectFilters,
    });
    const filtered = filterWorkspacesByLabels({ workspaces: byProject, ...labelFilter });
    return new Map(filtered.map((workspace) => [workspace.workspaceKey, workspace]));
  }, [labelFilter, resolvedProjectFilters, workspaceEntriesByKey]);
  const visibleWorkspaceKeys = useMemo(
    () => new Set(filteredWorkspaceEntriesByKey.keys()),
    [filteredWorkspaceEntriesByKey],
  );
  // The two filters prune differently on purpose. The project filter is a membership test on the
  // project itself, so a project you filtered TO survives even with no workspaces — it still owns
  // a header row you can create your first workspace under. The label filter can only ask about
  // workspaces, so a project it empties has nothing left to show.
  const filteredProjects = useMemo(() => {
    let projects = list.projects;
    if (hasActiveProjectFilter) {
      const included = new Set(resolvedProjectFilters);
      projects = projects.filter((project) => included.has(project.projectKey));
    }
    if (hasActiveLabelFilter) {
      projects = projects.flatMap((project) => {
        const workspaces = project.workspaces.filter((workspace) =>
          visibleWorkspaceKeys.has(workspace.workspaceKey),
        );
        return workspaces.length > 0 ? [{ ...project, workspaces }] : [];
      });
    }
    return projects;
  }, [
    hasActiveLabelFilter,
    hasActiveProjectFilter,
    resolvedProjectFilters,
    list.projects,
    visibleWorkspaceKeys,
  ]);
  const pinnedKeys = usePinnedSidebarKeys(filteredProjects);
  const projection = useMemo(
    () =>
      buildSidebarProjection({
        projects: filteredProjects,
        workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
        attentionOnly,
        pinnedKeys,
        pinnedWorkspaceOrder,
        pinnedCollapsed: collapsedPinned,
      }),
    [
      attentionOnly,
      filteredProjects,
      filteredWorkspaceEntriesByKey,
      pinnedKeys,
      pinnedWorkspaceOrder,
      collapsedPinned,
    ],
  );
  const value = useMemo(
    () => ({
      ...list,
      projects: projection.projects,
      needsAttentionWorkspaceCount: projection.needsAttentionWorkspaceCount,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      shortcutModel: projection.shortcutModel,
      pinnedGroups: projection.pinnedGroups,
      allProjects: list.projects,
      resolvedProjectFilters,
      hasProjectsBeforeFilter: list.projects.length > 0,
    }),
    [
      list,
      projection.needsAttentionWorkspaceCount,
      projection.projects,
      projection.shortcutModel,
      projection.pinnedGroups,
      filteredWorkspaceEntriesByKey,
      resolvedProjectFilters,
    ],
  );

  return <SidebarModelContext.Provider value={value}>{children}</SidebarModelContext.Provider>;
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}
