import type { PinnedSidebarGroups, PinnedSidebarKeys } from "@/hooks/use-sidebar-pins";
import { splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";
import { isAgentStatusNeedingAttention } from "@/utils/workspace-agent-summary";
import { aggregateSidebarStateBuckets } from "@/utils/sidebar-agent-state";

export interface SidebarProjectedProject extends SidebarProjectEntry {
  needsAttentionCount: number;
  statusBucket: SidebarWorkspaceEntry["statusBucket"];
}

export interface SidebarProjection {
  projects: SidebarProjectedProject[];
  pinnedGroups: PinnedSidebarGroups;
  needsAttentionWorkspaceCount: number;
  shortcutModel: SidebarShortcutModel;
}

// Sidebar order is user-managed: the input order (persisted drag order) is
// authoritative and never reordered by status changes. Attention is surfaced
// in place (row badges) plus an explicit attention-only filter; when the
// filter is on, projects without attention workspaces are hidden and projects
// show only their attention workspaces.
export function buildSidebarProjection(input: {
  projects: readonly SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  attentionOnly: boolean;
  pinnedKeys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  pinnedCollapsed: boolean;
}): SidebarProjection {
  const needsAttention = (workspace: SidebarWorkspacePlacement): boolean => {
    const entry = input.workspaceEntriesByKey.get(workspace.workspaceKey);
    return entry ? isAgentStatusNeedingAttention(entry.statusBucket) : false;
  };

  // Pinned chats are hoisted out of their project into their own section, so the projected
  // project list below is always the post-split remainder.
  const { pinnedChats, unpinnedProjects } = splitPinnedSidebarGroups({
    projects: [...input.projects],
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
  });
  const visiblePinnedChats = input.attentionOnly ? pinnedChats.filter(needsAttention) : pinnedChats;

  let needsAttentionWorkspaceCount = visiblePinnedChats.filter(needsAttention).length;
  const projectedProjects: SidebarProjectedProject[] = [];

  for (const project of unpinnedProjects) {
    let attentionCount = 0;
    const workspaces = project.workspaces.filter((workspace) => {
      const needsAttentionWorkspace = needsAttention(workspace);
      if (needsAttentionWorkspace) {
        attentionCount += 1;
        return true;
      }
      return !input.attentionOnly;
    });
    needsAttentionWorkspaceCount += attentionCount;
    if (input.attentionOnly && attentionCount === 0) {
      continue;
    }
    projectedProjects.push({
      ...project,
      workspaces,
      needsAttentionCount: attentionCount,
      statusBucket: aggregateSidebarStateBuckets(
        project.workspaces.flatMap((workspace) => {
          const bucket = input.workspaceEntriesByKey.get(workspace.workspaceKey)?.statusBucket;
          return bucket ? [bucket] : [];
        }),
      ),
    });
  }

  // Shortcut numbers follow the visual order: the Pinned section first, then the projects.
  // A collapsed Pinned section hands its numbers back to the rows below it.
  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: visiblePinnedChats });
  }
  for (const project of projectedProjects) {
    sections.push({ workspaces: project.workspaces });
  }

  return {
    projects: projectedProjects,
    pinnedGroups: { pinnedChats: visiblePinnedChats, unpinnedProjects },
    needsAttentionWorkspaceCount,
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}
