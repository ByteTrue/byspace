export interface ProjectIconLookupTarget {
  projectId?: string;
  iconWorkingDir: string;
}

export function resolveProjectIconLookup(
  target: ProjectIconLookupTarget,
  supportsCustomIcons: boolean,
): { kind: "project"; projectId: string } | { kind: "legacy"; cwd: string } {
  return supportsCustomIcons && target.projectId
    ? { kind: "project", projectId: target.projectId }
    : { kind: "legacy", cwd: target.iconWorkingDir };
}
