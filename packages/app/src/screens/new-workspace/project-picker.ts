import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ComboboxOption as ComboboxOptionType } from "@/components/ui/combobox";
import { isWorkspaceArchivePending } from "@/contexts/session-workspace-upserts";
import {
  getWorkspaceCreationHosts,
  resolveSelectedHostProject,
  resolveHostProjectWorkspaceIdentity,
  type HostProjectListItem,
} from "@/projects/host-projects";
import {
  createProjectSelection,
  reconcileProjectSelection,
  resolveProjectSelection,
  type ProjectSelection,
  type ProjectSelectionContext,
} from "./project-selection";

const PROJECT_OPTION_PREFIX = "project:";

interface NewWorkspaceProjectPickerInput {
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  routeProjectKey: string | null;
  workspaceMultiplicityByServerId: ReadonlyMap<string, boolean>;
  preserveMissingProject: boolean;
}

interface NewWorkspaceProjectPickerState {
  selectedProject: HostProjectListItem | null;
  projectPickerOptions: ComboboxOptionType[];
  projectByOptionId: Map<string, HostProjectListItem>;
  selectedProjectOptionId: string;
  projectTriggerLabel: string;
  handleSelectProjectOption: (id: string) => void;
}

function projectOptionId(projectId: string): string {
  return `${PROJECT_OPTION_PREFIX}${projectId}`;
}

function computeProjectOptionData(projects: readonly HostProjectListItem[]) {
  const projectByOptionId = new Map<string, HostProjectListItem>();
  const options = projects.map((project) => {
    const id = projectOptionId(project.projectKey);
    projectByOptionId.set(id, project);
    return { id, label: project.projectName };
  });
  return { options, projectByOptionId };
}

function hasPendingArchiveForProject(project: HostProjectListItem): boolean {
  return project.workspaceKeys.some((workspaceKey) => {
    const identity = resolveHostProjectWorkspaceIdentity(project, workspaceKey);
    return identity ? isWorkspaceArchivePending(identity) : false;
  });
}

export function useNewWorkspaceProjectPicker({
  projects,
  routeProject,
  routeProjectKey,
  workspaceMultiplicityByServerId,
  preserveMissingProject,
}: NewWorkspaceProjectPickerInput): NewWorkspaceProjectPickerState {
  const { t } = useTranslation();
  const selectableProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          getWorkspaceCreationHosts({ project, workspaceMultiplicityByServerId }).length > 0,
      ),
    [projects, workspaceMultiplicityByServerId],
  );
  const initialProject = useMemo(
    () =>
      resolveSelectedHostProject({
        selectedProjectKey: routeProjectKey,
        projects: selectableProjects,
        routeProject,
      }),
    [routeProject, routeProjectKey, selectableProjects],
  );

  const selectionContextKey = routeProjectKey ?? "";
  const shouldPreserveMissingProject = useCallback(
    (project: HostProjectListItem) =>
      preserveMissingProject || hasPendingArchiveForProject(project),
    [preserveMissingProject],
  );
  const selectionContext = useMemo<ProjectSelectionContext>(
    () => ({
      contextKey: selectionContextKey,
      initialProject,
      projects: selectableProjects,
      routeProject,
      shouldPreserveMissingProject,
    }),
    [
      initialProject,
      routeProject,
      selectableProjects,
      selectionContextKey,
      shouldPreserveMissingProject,
    ],
  );
  const [projectSelection, setProjectSelection] = useState<ProjectSelection>(() =>
    createProjectSelection(selectionContext),
  );

  useEffect(() => {
    setProjectSelection((current) => reconcileProjectSelection(current, selectionContext));
  }, [selectionContext]);

  const activeSelection = reconcileProjectSelection(projectSelection, selectionContext);
  const selectedProject = resolveProjectSelection(activeSelection, selectionContext);
  const { options: projectPickerOptions, projectByOptionId } = useMemo(
    () => computeProjectOptionData(selectableProjects),
    [selectableProjects],
  );
  const handleSelectProjectOption = useCallback(
    (id: string) => {
      const project = projectByOptionId.get(id);
      if (!project) return;
      setProjectSelection({
        contextKey: selectionContextKey,
        projectKey: project.projectKey,
        project,
        source: "manual",
      });
    },
    [projectByOptionId, selectionContextKey],
  );

  return {
    selectedProject,
    projectPickerOptions,
    projectByOptionId,
    selectedProjectOptionId: selectedProject ? projectOptionId(selectedProject.projectKey) : "",
    projectTriggerLabel: selectedProject?.projectName ?? t("newWorkspace.project.choose"),
    handleSelectProjectOption,
  };
}
