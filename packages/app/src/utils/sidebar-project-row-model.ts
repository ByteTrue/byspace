import { getWorkspaceCreationHosts } from "@/projects/host-projects";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";

export interface SidebarProjectHostTarget {
  serverId: string;
  projectId?: string;
  iconWorkingDir: string;
}

export interface SidebarProjectNewWorkspaceTarget {
  projectKey: string;
}

export type SidebarProjectTrailingAction =
  | { kind: "new_workspace"; target: SidebarProjectNewWorkspaceTarget }
  | { kind: "none" };

export interface SidebarProjectSectionRowModel {
  kind: "project_section";
  chevron: "expand" | "collapse";
  trailingAction: SidebarProjectTrailingAction;
}

export type SidebarProjectRowModel = SidebarProjectSectionRowModel;

const EMPTY_MULTIPLICITY_MAP: ReadonlyMap<string, boolean> = new Map();

function hostTarget(input: {
  serverId: string;
  projectId?: string;
  iconWorkingDir: string;
}): SidebarProjectHostTarget | null {
  const iconWorkingDir = input.iconWorkingDir.trim();
  if (!input.serverId || !iconWorkingDir) {
    return null;
  }
  return { serverId: input.serverId, projectId: input.projectId, iconWorkingDir };
}

export function resolveSidebarProjectIconTarget(
  project: SidebarProjectEntry,
): SidebarProjectHostTarget | null {
  for (const host of project.hosts) {
    const target = hostTarget(host);
    if (target) {
      return target;
    }
  }
  return null;
}

function resolveNewWorkspaceTarget(
  project: SidebarProjectEntry,
  workspaceMultiplicityByServerId: ReadonlyMap<string, boolean>,
): SidebarProjectNewWorkspaceTarget | null {
  const projectKey = project.projectKey;
  if (!projectKey.trim()) {
    return null;
  }
  const hosts = getWorkspaceCreationHosts({ project, workspaceMultiplicityByServerId });
  return hosts.length > 0 ? { projectKey } : null;
}

function projectTrailingAction(
  project: SidebarProjectEntry,
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>,
): SidebarProjectTrailingAction {
  const target = resolveNewWorkspaceTarget(project, supportsMultiplicityByServerId);
  return target ? { kind: "new_workspace", target } : { kind: "none" };
}

export function buildSidebarProjectRowModel(input: {
  project: SidebarProjectEntry;
  collapsed: boolean;
  supportsMultiplicityByServerId?: ReadonlyMap<string, boolean>;
}): SidebarProjectRowModel {
  return {
    kind: "project_section",
    chevron: input.collapsed ? "expand" : "collapse",
    trailingAction: projectTrailingAction(
      input.project,
      input.supportsMultiplicityByServerId ?? EMPTY_MULTIPLICITY_MAP,
    ),
  };
}
