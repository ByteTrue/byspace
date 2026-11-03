// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import { useNewWorkspaceProjectPicker } from "./project-picker";

function project(input: {
  viewKey: string;
  projectKey: string | null;
  projectId: string;
  projectName: string;
}): HostProjectListItem {
  return {
    ...input,
    projectKind: "git",
    iconWorkingDir: `/work/${input.projectId}`,
    hosts: [
      {
        serverId: "host",
        projectId: input.projectId,
        iconWorkingDir: `/work/${input.projectId}`,
        worktreeSupport: "supported",
      },
    ],
    workspaceKeys: [],
  };
}

describe("useNewWorkspaceProjectPicker", () => {
  it("preserves a manual choice when the routed project hydrates", () => {
    const routePlacement = project({
      viewKey: '["host","route-local"]',
      projectKey: null,
      projectId: "route-local",
      projectName: "Route project",
    });
    const hydratedRouteProject = project({
      viewKey: "remote:github.com/acme/route",
      projectKey: "remote:github.com/acme/route",
      projectId: "route-local",
      projectName: "Route project",
    });
    const manualProject = project({
      viewKey: "remote:github.com/acme/manual",
      projectKey: "remote:github.com/acme/manual",
      projectId: "manual-local",
      projectName: "Manual project",
    });
    const { result, rerender } = renderHook(
      ({ routeProject, projects }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject,
          routeProjectContextViewKey: routePlacement.viewKey,
          lastActiveProject: null,
          allowAllProjects: true,
        }),
      {
        initialProps: {
          routeProject: routePlacement,
          projects: [routePlacement, manualProject],
        },
      },
    );

    const manualOption = result.current.projectPickerOptions.find(
      (option) => option.label === manualProject.projectName,
    );
    expect(manualOption).toBeDefined();
    act(() => result.current.handleSelectProjectOption(manualOption!.id));
    expect(result.current.selectedProject).toEqual(manualProject);

    rerender({
      routeProject: hydratedRouteProject,
      projects: [hydratedRouteProject, manualProject],
    });

    expect(result.current.selectedProject).toEqual(manualProject);
  });

  it("includes projects from other hosts and allows selecting them", () => {
    const projectHostA = project({
      viewKey: "remote:github.com/acme/project-a",
      projectKey: "remote:github.com/acme/project-a",
      projectId: "proj-a",
      projectName: "Project On Host A",
    });
    const projectHostB: HostProjectListItem = {
      viewKey: "remote:github.com/acme/project-b",
      projectKey: "remote:github.com/acme/project-b",
      projectName: "Project On Host B",
      projectKind: "git",
      iconWorkingDir: "/work/proj-b",
      hosts: [
        {
          serverId: "host-b",
          projectId: "proj-b",
          iconWorkingDir: "/work/proj-b",
          worktreeSupport: "supported",
        },
      ],
      workspaceKeys: [],
    };

    const projectsList = [projectHostA, projectHostB];
    const { result } = renderHook(() =>
      useNewWorkspaceProjectPicker({
        selectedServerId: "host-a",
        projects: projectsList,
        routeProject: null,
        routeProjectContextViewKey: null,
        lastActiveProject: null,
        allowAllProjects: true,
      }),
    );

    // Both projects appear in options even though selectedServerId is host-a
    expect(result.current.projectPickerOptions).toHaveLength(2);
    expect(
      result.current.projectPickerOptions.some((opt) => opt.label === "Project On Host B"),
    ).toBe(true);

    const optionB = result.current.projectPickerOptions.find(
      (opt) => opt.label === "Project On Host B",
    )!;
    act(() => result.current.handleSelectProjectOption(optionB.id));
    expect(result.current.selectedProject).toEqual(projectHostB);
  });
});
