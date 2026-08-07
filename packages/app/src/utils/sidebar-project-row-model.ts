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

export function resolveSidebarProjectNewWorkspaceTarget(input: {
  project: SidebarProjectEntry;
  supportsMultiplicityByServerId?: ReadonlyMap<string, boolean>;
}): SidebarProjectNewWorkspaceTarget | null {
  const projectKey = input.project.projectKey;
  if (!projectKey.trim()) {
    return null;
  }
  const hosts = getWorkspaceCreationHosts({
    project: input.project,
    workspaceMultiplicityByServerId: input.supportsMultiplicityByServerId ?? EMPTY_MULTIPLICITY_MAP,
  });
  return hosts.length > 0 ? { projectKey } : null;
}
