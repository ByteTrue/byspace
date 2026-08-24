export interface ProjectIconLookupTarget {
  projectId?: string;
  iconWorkingDir: string;
}

export interface ProjectIconRequestTarget extends ProjectIconLookupTarget {
  serverId: string;
  projectKey: string;
  customIconRevision?: string | null;
  iconRevision?: string;
}

export function buildProjectIconRequestTarget(
  projectKey: string,
  placement: {
    serverId: string;
    projectId?: string;
    iconWorkingDir: string;
    customIconRevision?: string | null;
    iconRevision?: string;
  },
): ProjectIconRequestTarget {
  return {
    serverId: placement.serverId,
    projectKey,
    projectId: placement.projectId,
    iconWorkingDir: placement.iconWorkingDir,
    customIconRevision: placement.customIconRevision,
    iconRevision: placement.iconRevision,
  };
}

export function resolveProjectIconLookup(
  target: ProjectIconLookupTarget,
  supportsCustomIcons: boolean | null,
): { kind: "project"; projectId: string } | { kind: "legacy"; cwd: string } | null {
  if (supportsCustomIcons === null) return null;
  return supportsCustomIcons && target.projectId
    ? { kind: "project", projectId: target.projectId }
    : { kind: "legacy", cwd: target.iconWorkingDir };
}
