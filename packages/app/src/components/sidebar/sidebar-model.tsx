import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useSidebarWorkspacesList,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection, type SidebarProjectedProject } from "./sidebar-projection";

interface SidebarModel extends Omit<SidebarWorkspacesListResult, "projects"> {
  projects: SidebarProjectedProject[];
  needsAttentionProjectCount: number;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  collapsedProjectKeys: ReadonlySet<string>;
  toggleProjectCollapsed: (projectKey: string) => void;
  shortcutModel: SidebarShortcutModel;
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
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const toggleProjectCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleProjectCollapsed,
  );
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(list.workspacePlacements, true);
  const pinnedKeys = usePinnedSidebarKeys(list.projects);
  const projection = useMemo(
    () =>
      buildSidebarProjection({
        projects: list.projects,
        pinnedKeys,
        workspaceEntriesByKey,
        projectNamesByKey: list.projectNamesByKey,
        collapsedProjectKeys,
      }),
    [
      collapsedProjectKeys,
      list.projectNamesByKey,
      list.projects,
      pinnedKeys,
      workspaceEntriesByKey,
    ],
  );
  const projects = useMemo(
    () => [...projection.needsAttentionProjects, ...projection.otherProjects],
    [projection.needsAttentionProjects, projection.otherProjects],
  );
  const value = useMemo(
    () => ({
      ...list,
      projects,
      needsAttentionProjectCount: projection.needsAttentionProjects.length,
      workspaceEntriesByKey,
      collapsedProjectKeys,
      toggleProjectCollapsed,
      shortcutModel: projection.shortcutModel,
    }),
    [
      collapsedProjectKeys,
      list,
      projects,
      projection.needsAttentionProjects.length,
      projection.shortcutModel,
      toggleProjectCollapsed,
      workspaceEntriesByKey,
    ],
  );

  return <SidebarModelContext.Provider value={value}>{children}</SidebarModelContext.Provider>;
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}
