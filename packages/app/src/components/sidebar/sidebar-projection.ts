import type { PinnedSidebarKeys } from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarStateBucket,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarShortcutSections, type SidebarShortcutModel } from "@/utils/sidebar-shortcuts";

export interface SidebarProjectedProject extends SidebarProjectEntry {
  needsAttentionCount: number;
}

export interface SidebarProjection {
  needsAttentionProjects: SidebarProjectedProject[];
  otherProjects: SidebarProjectedProject[];
  shortcutModel: SidebarShortcutModel;
}

export function buildSidebarProjection(input: {
  projects: readonly SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByKey: ReadonlyMap<string, string>;
  collapsedProjectKeys: ReadonlySet<string>;
}): SidebarProjection {
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const originalProjectIndex = new Map(
    input.projects.map((project, index) => [project.projectKey, index]),
  );
  const projectedProjects = input.projects.map((project) => {
    const originalWorkspaceIndex = new Map(
      project.workspaces.map((workspace, index) => [workspace.workspaceKey, index]),
    );
    const workspaces = [...project.workspaces].sort((left, right) =>
      compareWorkspaces({
        left,
        right,
        entries: input.workspaceEntriesByKey,
        pinnedWorkspaceKeys,
        originalWorkspaceIndex,
      }),
    );
    const entries = workspaces
      .map((workspace) => input.workspaceEntriesByKey.get(workspace.workspaceKey))
      .filter((entry): entry is SidebarWorkspaceEntry => Boolean(entry));
    return {
      ...project,
      workspaces,
      needsAttentionCount: entries.filter((entry) => needsAttention(entry.statusBucket)).length,
    };
  });

  const needsAttentionProjects = projectedProjects
    .filter((project) => project.needsAttentionCount > 0)
    .sort((left, right) => {
      const waitingDifference =
        oldestAttentionAt(left, input.workspaceEntriesByKey) -
        oldestAttentionAt(right, input.workspaceEntriesByKey);
      return (
        waitingDifference ||
        (originalProjectIndex.get(left.projectKey) ?? 0) -
          (originalProjectIndex.get(right.projectKey) ?? 0)
      );
    });
  const otherProjects = projectedProjects
    .filter((project) => project.needsAttentionCount === 0)
    .sort((left, right) => {
      const leftEmpty = left.workspaces.length === 0;
      const rightEmpty = right.workspaces.length === 0;
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      const activityDifference =
        latestActivityAt(right, input.workspaceEntriesByKey) -
        latestActivityAt(left, input.workspaceEntriesByKey);
      return (
        activityDifference ||
        (originalProjectIndex.get(left.projectKey) ?? 0) -
          (originalProjectIndex.get(right.projectKey) ?? 0)
      );
    });

  return {
    needsAttentionProjects,
    otherProjects,
    shortcutModel: buildSidebarShortcutSections({
      sections: [...needsAttentionProjects, ...otherProjects].map((project) => ({
        workspaces: project.workspaces,
        collapsed: input.collapsedProjectKeys.has(project.projectKey),
      })),
    }),
  };
}

function compareWorkspaces(input: {
  left: SidebarWorkspacePlacement;
  right: SidebarWorkspacePlacement;
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>;
  pinnedWorkspaceKeys: ReadonlySet<string>;
  originalWorkspaceIndex: ReadonlyMap<string, number>;
}): number {
  const leftEntry = input.entries.get(input.left.workspaceKey);
  const rightEntry = input.entries.get(input.right.workspaceKey);
  const leftNeedsAttention = leftEntry ? needsAttention(leftEntry.statusBucket) : false;
  const rightNeedsAttention = rightEntry ? needsAttention(rightEntry.statusBucket) : false;
  if (leftNeedsAttention !== rightNeedsAttention) return leftNeedsAttention ? -1 : 1;

  if (leftNeedsAttention && rightNeedsAttention) {
    const waitingDifference = workspaceAttentionAt(leftEntry) - workspaceAttentionAt(rightEntry);
    if (waitingDifference !== 0) return waitingDifference;
  } else {
    const leftPinned = input.pinnedWorkspaceKeys.has(input.left.workspaceKey);
    const rightPinned = input.pinnedWorkspaceKeys.has(input.right.workspaceKey);
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    const activityDifference = workspaceActivityAt(rightEntry) - workspaceActivityAt(leftEntry);
    if (activityDifference !== 0) return activityDifference;
  }

  return (
    (input.originalWorkspaceIndex.get(input.left.workspaceKey) ?? 0) -
    (input.originalWorkspaceIndex.get(input.right.workspaceKey) ?? 0)
  );
}

function needsAttention(status: SidebarStateBucket): boolean {
  return status === "needs_input" || status === "failed" || status === "attention";
}

function workspaceAttentionAt(entry: SidebarWorkspaceEntry | undefined): number {
  return (entry?.agentSummary?.oldestAttentionAt ?? entry?.statusEnteredAt)?.getTime() ?? Infinity;
}

function workspaceActivityAt(entry: SidebarWorkspaceEntry | undefined): number {
  return (entry?.agentSummary?.latestActivityAt ?? entry?.statusEnteredAt)?.getTime() ?? 0;
}

function oldestAttentionAt(
  project: SidebarProjectEntry,
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
): number {
  let oldest = Infinity;
  for (const workspace of project.workspaces) {
    const entry = entries.get(workspace.workspaceKey);
    if (entry && needsAttention(entry.statusBucket)) {
      oldest = Math.min(oldest, workspaceAttentionAt(entry));
    }
  }
  return oldest;
}

function latestActivityAt(
  project: SidebarProjectEntry,
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
): number {
  let latest = 0;
  for (const workspace of project.workspaces) {
    latest = Math.max(latest, workspaceActivityAt(entries.get(workspace.workspaceKey)));
  }
  return latest;
}
