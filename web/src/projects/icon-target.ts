export interface ProjectIconPlacement {
  serverId: string;
  projectId: string;
  iconWorkingDir: string;
  customIconRevision?: string | null;
  iconRevision?: string;
}

export interface ProjectIconTarget extends ProjectIconPlacement {
  projectViewKey: string;
  iconRevision: string;
}

export function createProjectIconTarget(input: {
  projectViewKey: string;
  placement: ProjectIconPlacement;
}): ProjectIconTarget | null {
  const iconWorkingDir = input.placement.iconWorkingDir.trim();
  // The effective icon revision only exists once the host sent a project descriptor; a
  // route-only context has none, and there is no icon lookup to cache without it.
  if (
    !input.placement.serverId ||
    !input.placement.projectId ||
    !iconWorkingDir ||
    !input.placement.iconRevision
  )
    return null;
  return {
    projectViewKey: input.projectViewKey,
    serverId: input.placement.serverId,
    projectId: input.placement.projectId,
    iconWorkingDir,
    customIconRevision: input.placement.customIconRevision,
    iconRevision: input.placement.iconRevision,
  };
}
