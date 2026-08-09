import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import {
  createProjectSelection,
  reconcileProjectSelection,
  resolveProjectSelection,
  type ProjectSelection,
  type ProjectSelectionContext,
} from "./project-selection";

function project(projectKey: string, serverId = "host"): HostProjectListItem {
  return {
    projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: `/work/${projectKey}`,
    hosts: [
      {
        serverId,
        projectId: projectKey,
        iconWorkingDir: `/work/${projectKey}`,
        canCreateWorktree: true,
      },
    ],
    workspaceKeys: [],
  };
}

function context(
  input: Partial<ProjectSelectionContext> & {
    initialProject: HostProjectListItem | null;
    projects: HostProjectListItem[];
  },
): ProjectSelectionContext {
  return {
    contextKey: "",
    routeProject: null,
    shouldPreserveMissingProject: () => false,
    ...input,
  };
}

describe("reconcileProjectSelection", () => {
  it("resets a manual selection when the route project changes", () => {
    const manual = project("manual");
    const routed = project("routed");
    const current: ProjectSelection = {
      contextKey: "previous-route",
      projectKey: manual.projectKey,
      project: manual,
      source: "manual",
    };
    const nextContext = context({
      contextKey: routed.projectKey,
      initialProject: routed,
      projects: [manual, routed],
      routeProject: routed,
    });

    expect(reconcileProjectSelection(current, nextContext)).toEqual({
      contextKey: routed.projectKey,
      projectKey: routed.projectKey,
      project: routed,
      source: "initial",
    });
  });

  it("hydrates an empty routed selection when projects arrive", () => {
    const hydrated = project("hydrated");
    const current = createProjectSelection(
      context({ contextKey: hydrated.projectKey, initialProject: null, projects: [] }),
    );
    const hydratedContext = context({
      contextKey: hydrated.projectKey,
      initialProject: hydrated,
      projects: [hydrated],
      routeProject: hydrated,
    });

    expect(reconcileProjectSelection(current, hydratedContext).project).toBe(hydrated);
  });

  it("adopts a routed project's hydrated cross-host key", () => {
    const routed = project("local-project-id");
    const hydrated = {
      ...project("remote:github.com/acme/project"),
      hosts: routed.hosts,
    };
    const current = createProjectSelection(
      context({
        contextKey: "route-key",
        initialProject: routed,
        projects: [],
        routeProject: routed,
      }),
    );
    const hydratedContext = context({
      contextKey: "route-key",
      initialProject: hydrated,
      projects: [hydrated],
      routeProject: routed,
    });

    expect(reconcileProjectSelection(current, hydratedContext).project).toBe(hydrated);
  });

  it("keeps a selectable manual project while route hydration completes", () => {
    const manual = project("manual");
    const routed = project("routed");
    const current: ProjectSelection = {
      contextKey: "route-key",
      projectKey: manual.projectKey,
      project: manual,
      source: "manual",
    };
    const hydratedContext = context({
      contextKey: "route-key",
      initialProject: routed,
      projects: [manual, routed],
      routeProject: routed,
    });

    expect(reconcileProjectSelection(current, hydratedContext)).toBe(current);
  });

  it("preserves opaque project keys ending in whitespace", () => {
    const selected = project("host:project ");
    const currentContext = context({ initialProject: selected, projects: [selected] });
    const current = createProjectSelection(currentContext);

    expect(resolveProjectSelection(current, currentContext)).toBe(selected);
    expect(reconcileProjectSelection(current, currentContext)).toBe(current);
  });

  it("keeps the selected snapshot during a pending archive gap", () => {
    const selected = { ...project("selected"), workspaceKeys: ["host:workspace"] };
    const current = createProjectSelection(
      context({ initialProject: selected, projects: [selected] }),
    );
    const archiveGap = context({
      initialProject: null,
      projects: [],
      shouldPreserveMissingProject: (candidate) => candidate.workspaceKeys.length > 0,
    });

    expect(reconcileProjectSelection(current, archiveGap)).toBe(current);
    expect(resolveProjectSelection(current, archiveGap)).toBe(selected);
  });

  it("clears a project that disappears without a pending archive", () => {
    const selected = project("selected");
    const current = createProjectSelection(
      context({ initialProject: selected, projects: [selected] }),
    );
    const withoutSelected = context({ initialProject: null, projects: [] });

    expect(reconcileProjectSelection(current, withoutSelected)).toEqual({
      contextKey: "",
      projectKey: null,
      project: null,
      source: "initial",
    });
  });
});
