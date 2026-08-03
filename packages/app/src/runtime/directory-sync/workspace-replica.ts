import type { SessionOutboundMessage } from "@bytetrue/byspace-protocol/messages";
import {
  normalizeEmptyProjectDescriptor,
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type EmptyProjectDescriptor,
  type ProjectDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";
import {
  clearWorkspaceArchivePending,
  shouldSuppressWorkspaceForLocalArchive,
} from "@/contexts/session-workspace-upserts";

export type WorkspaceDirectoryDelta = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export interface WorkspaceDirectorySnapshot {
  workspaces: Map<string, WorkspaceDescriptor>;
  emptyProjects: Map<string, EmptyProjectDescriptor>;
  projects: Map<string, ProjectDescriptor>;
}

export class WorkspaceDirectoryReplica {
  constructor(private readonly serverId: string) {}

  applyDelta(delta: WorkspaceDirectoryDelta): void {
    const state = this.reconcile(this.read(), [delta]);
    this.commit(state, delta.kind === "remove" ? [delta.id] : []);
  }

  commitSnapshot(
    snapshot: WorkspaceDirectorySnapshot,
    deltas: readonly WorkspaceDirectoryDelta[],
  ): void {
    const removedWorkspaceIds = deltas.flatMap((delta) =>
      delta.kind === "remove" ? [delta.id] : [],
    );
    this.commit(this.reconcile(snapshot, deltas), removedWorkspaceIds);
  }

  private read(): WorkspaceDirectorySnapshot {
    const session = useSessionStore.getState().sessions[this.serverId];
    return {
      workspaces: new Map(session?.workspaces),
      emptyProjects: new Map(session?.emptyProjects),
      projects: new Map(session?.projects),
    };
  }

  private reconcile(
    snapshot: WorkspaceDirectorySnapshot,
    deltas: readonly WorkspaceDirectoryDelta[],
  ): WorkspaceDirectorySnapshot {
    const workspaces = new Map(snapshot.workspaces);
    const emptyProjects = new Map(snapshot.emptyProjects);
    const projects = new Map(snapshot.projects);
    for (const [workspaceId, workspace] of workspaces) {
      if (shouldSuppressWorkspaceForLocalArchive({ serverId: this.serverId, workspace })) {
        workspaces.delete(workspaceId);
      }
    }
    for (const delta of deltas) {
      if (delta.kind === "remove") {
        workspaces.delete(delta.id);
        if (delta.emptyProject) {
          const project = normalizeEmptyProjectDescriptor(delta.emptyProject);
          emptyProjects.set(project.projectId, project);
          projects.set(project.projectId, normalizeProjectDescriptor(delta.emptyProject));
        }
        if (delta.removedProjectId) {
          emptyProjects.delete(delta.removedProjectId);
          projects.delete(delta.removedProjectId);
        }
        continue;
      }
      const workspace = normalizeWorkspaceDescriptor(delta.workspace);
      if (shouldSuppressWorkspaceForLocalArchive({ serverId: this.serverId, workspace })) {
        workspaces.delete(workspace.id);
      } else {
        workspaces.set(workspace.id, workspace);
        emptyProjects.delete(workspace.projectId);
        projects.set(
          workspace.projectId,
          projectDescriptorFromWorkspace(workspace, projects.get(workspace.projectId)),
        );
      }
    }
    for (const workspace of workspaces.values()) {
      if (!projects.has(workspace.projectId)) {
        projects.set(workspace.projectId, projectDescriptorFromWorkspace(workspace));
      }
    }
    for (const emptyProject of emptyProjects.values()) {
      if (!projects.has(emptyProject.projectId)) {
        projects.set(emptyProject.projectId, {
          ...emptyProject,
          projectKey: emptyProject.projectKey ?? null,
        });
      }
    }
    return { workspaces, emptyProjects, projects };
  }

  private commit(snapshot: WorkspaceDirectorySnapshot, removedWorkspaceIds: string[]): void {
    const store = useSessionStore.getState();
    store.setWorkspaces(this.serverId, snapshot.workspaces);
    store.setEmptyProjects(this.serverId, snapshot.emptyProjects.values());
    store.setProjects(this.serverId, snapshot.projects.values());
    store.setHasHydratedWorkspaces(this.serverId, true);
    for (const workspaceId of removedWorkspaceIds) {
      clearWorkspaceArchivePending({ serverId: this.serverId, workspaceId });
      useWorkspaceSetupStore.getState().removeWorkspace({ serverId: this.serverId, workspaceId });
    }
  }
}

function projectDescriptorFromWorkspace(
  workspace: WorkspaceDescriptor,
  existingProject?: ProjectDescriptor,
): ProjectDescriptor {
  return {
    projectId: workspace.projectId,
    projectKey: workspace.project?.projectKey ?? existingProject?.projectKey ?? null,
    projectDisplayName: workspace.projectDisplayName,
    projectCustomName: workspace.projectCustomName ?? null,
    projectRootPath: workspace.projectRootPath,
    projectKind: workspace.projectKind,
  };
}
