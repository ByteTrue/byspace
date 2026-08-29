import { useMemo } from "react";
import { useWorkspaceStructure } from "@/stores/session-store-hooks";
import { buildHostProjectList, type HostProjectListItem } from "@/projects/host-project-model";

export {
  buildHostProjectList,
  canCreateWorktreeForProjectKind,
  getHostProjectId,
  getHostProjectSourceDirectory,
  getWorkspaceCreationHosts,
  hostProjectFromRoute,
  resolveSelectedHostProject,
  resolveHostProjectWorkspaceIdentity,
  type HostProjectListItem,
  type HostProjectRouteContext,
} from "@/projects/host-project-model";

export function useHostProjects(serverIds: string[]): HostProjectListItem[] {
  const workspaceStructure = useWorkspaceStructure(serverIds);
  return useMemo(() => {
    if (workspaceStructure.projects.length === 0) {
      return [];
    }
    return buildHostProjectList({ projects: workspaceStructure.projects });
  }, [workspaceStructure.projects]);
}
