import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useSidebarWorkspacesList,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection, type SidebarProjectedProject } from "./sidebar-projection";

interface SidebarModel extends Omit<SidebarWorkspacesListResult, "projects"> {
  projects: SidebarProjectedProject[];
  needsAttentionWorkspaceCount: number;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  shortcutModel: SidebarShortcutModel;
  pinnedGroups: PinnedSidebarGroups;
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
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(list.workspacePlacements, true);
  const pinnedKeys = usePinnedSidebarKeys(list.projects);
  const pinnedWorkspaceOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const projection = useMemo(
    () =>
      buildSidebarProjection({
        projects: list.projects,
        workspaceEntriesByKey,
        attentionOnly,
        pinnedKeys,
        pinnedWorkspaceOrder,
        pinnedCollapsed,
      }),
    [
      attentionOnly,
      list.projects,
      pinnedCollapsed,
      pinnedKeys,
      pinnedWorkspaceOrder,
      workspaceEntriesByKey,
    ],
  );
  const value = useMemo(
    () => ({
      ...list,
      projects: projection.projects,
      needsAttentionWorkspaceCount: projection.needsAttentionWorkspaceCount,
      workspaceEntriesByKey,
      shortcutModel: projection.shortcutModel,
      pinnedGroups: projection.pinnedGroups,
    }),
    [
      list,
      projection.needsAttentionWorkspaceCount,
      projection.projects,
      projection.shortcutModel,
      projection.pinnedGroups,
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
