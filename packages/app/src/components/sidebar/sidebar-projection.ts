import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarShortcutModel, type SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { isAgentStatusNeedingAttention } from "@/utils/workspace-agent-summary";

export interface SidebarProjectedProject extends SidebarProjectEntry {
  needsAttentionCount: number;
}

export interface SidebarProjection {
  projects: SidebarProjectedProject[];
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
}): SidebarProjection {
  let needsAttentionWorkspaceCount = 0;
  const projectedProjects: SidebarProjectedProject[] = [];

  for (const project of input.projects) {
    let attentionCount = 0;
    const workspaces = project.workspaces.filter((workspace) => {
      const entry = input.workspaceEntriesByKey.get(workspace.workspaceKey);
      const needsAttentionWorkspace = entry
        ? isAgentStatusNeedingAttention(entry.statusBucket)
        : false;
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
    projectedProjects.push({ ...project, workspaces, needsAttentionCount: attentionCount });
  }

  return {
    projects: projectedProjects,
    needsAttentionWorkspaceCount,
    shortcutModel: buildSidebarShortcutModel({ projects: projectedProjects }),
  };
}
