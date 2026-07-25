import { useCallback } from "react";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  cloneGithubProjectDirectly,
  openProjectDirectly,
  type OpenProjectResult,
  type ProjectGithubCloneProtocol,
} from "@/hooks/open-project";

export function useOpenProject(
  serverId: string | null,
): (path: string) => Promise<OpenProjectResult> {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const canAddProject = useSessionStore((state) => {
    if (!normalizedServerId) return false;
    const features = state.sessions[normalizedServerId]?.serverInfo?.features;
    // COMPAT(stableProjectIdentity): added in v0.2.0, remove gate after 2027-01-23.
    return features?.projectAdd === true && features.stableProjectIdentity === true;
  });
  const addEmptyProject = useSessionStore((state) => state.addEmptyProject);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);

  return useCallback(
    async (path: string) => {
      const result = await openProjectDirectly({
        serverId: normalizedServerId,
        projectPath: path,
        isConnected,
        canAddProject,
        client,
        addEmptyProject,
        setHasHydratedWorkspaces,
      });
      return result;
    },
    [
      addEmptyProject,
      canAddProject,
      client,
      isConnected,
      normalizedServerId,
      setHasHydratedWorkspaces,
    ],
  );
}

export function useCloneGithubProject(
  serverId: string | null,
): (
  repo: string,
  targetDirectory: string,
  cloneProtocol?: ProjectGithubCloneProtocol,
) => Promise<OpenProjectResult> {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const canCloneGithubProject = useSessionStore((state) => {
    if (!normalizedServerId) return false;
    const features = state.sessions[normalizedServerId]?.serverInfo?.features;
    // COMPAT(stableProjectIdentity): added in v0.2.0, remove gate after 2027-01-23.
    return features?.projectGithubClone === true && features.stableProjectIdentity === true;
  });
  const addEmptyProject = useSessionStore((state) => state.addEmptyProject);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);

  return useCallback(
    async (repo: string, targetDirectory: string, cloneProtocol?: ProjectGithubCloneProtocol) => {
      return cloneGithubProjectDirectly({
        serverId: normalizedServerId,
        repo,
        targetDirectory,
        ...(cloneProtocol ? { cloneProtocol } : {}),
        isConnected,
        canCloneGithubProject,
        client,
        addEmptyProject,
        setHasHydratedWorkspaces,
      });
    },
    [
      addEmptyProject,
      canCloneGithubProject,
      client,
      isConnected,
      normalizedServerId,
      setHasHydratedWorkspaces,
    ],
  );
}
