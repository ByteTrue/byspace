import { buildNewWorkspaceRoute } from "@/utils/host-routes";

interface ForkProjectPlacement {
  projectId?: string;
  projectKey?: string;
}

export function buildForkNewWorkspaceRoute(input: {
  serverId: string;
  sourceDirectory?: string;
  displayName?: string;
  workspaceProjectId: string | null;
  projectPlacement: ForkProjectPlacement | null | undefined;
  draftId: string;
}) {
  // COMPAT(projectPlacementProjectId): added in v0.2.5, remove the workspace fallback after
  // 2027-01-31. Old daemons omit placement.projectId; projectKey is never a mutation identity.
  const projectId = input.workspaceProjectId ?? input.projectPlacement?.projectId;
  return buildNewWorkspaceRoute({
    serverId: input.serverId,
    sourceDirectory: input.sourceDirectory,
    displayName: input.displayName,
    projectId,
    draftId: input.draftId,
  });
}
