import type { HostProjectListItem } from "@/projects/host-projects";

export interface ProjectSelection {
  contextKey: string;
  projectKey: string | null;
  project: HostProjectListItem | null;
  source: "initial" | "manual";
}

export interface ProjectSelectionContext {
  contextKey: string;
  initialProject: HostProjectListItem | null;
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  shouldPreserveMissingProject: (project: HostProjectListItem) => boolean;
}

export function createProjectSelection({
  contextKey,
  initialProject,
}: ProjectSelectionContext): ProjectSelection {
  return {
    contextKey,
    projectKey: initialProject?.projectKey ?? null,
    project: initialProject,
    source: "initial",
  };
}

function projectKeyOf(selection: ProjectSelection): string | null {
  const projectKey = selection.projectKey;
  return projectKey?.trim() ? projectKey : null;
}

export function resolveProjectSelection(
  selection: ProjectSelection,
  context: ProjectSelectionContext,
): HostProjectListItem | null {
  const projectKey = projectKeyOf(selection);
  if (!projectKey) return null;

  const selectableProject = context.projects.find((project) => project.projectKey === projectKey);
  if (selectableProject) return selectableProject;

  if (
    selection.project?.projectKey === projectKey &&
    context.shouldPreserveMissingProject(selection.project)
  ) {
    return selection.project;
  }

  return selection.source === "initial" && context.routeProject?.projectKey === projectKey
    ? context.routeProject
    : null;
}

export function reconcileProjectSelection(
  current: ProjectSelection,
  context: ProjectSelectionContext,
): ProjectSelection {
  const initialSelection = createProjectSelection(context);
  if (current.contextKey !== context.contextKey) return initialSelection;

  if (
    current.source === "initial" &&
    context.initialProject &&
    current.projectKey !== context.initialProject.projectKey
  ) {
    return initialSelection;
  }

  const resolvedProject = resolveProjectSelection(current, context);
  if (!resolvedProject) return initialSelection;
  if (current.projectKey === resolvedProject.projectKey && current.project === resolvedProject) {
    return current;
  }

  return {
    ...current,
    projectKey: resolvedProject.projectKey,
    project: resolvedProject,
  };
}
