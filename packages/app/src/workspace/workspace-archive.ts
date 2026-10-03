import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  clearWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/contexts/session-workspace-upserts";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { i18n } from "@/i18n/i18next";

export interface WorkspaceArchiveTarget {
  serverId: string;
  workspaceId: string;
}

interface WorkspaceArchiveClient {
  archiveWorkspace: (workspaceId: string) => Promise<{
    error: string | null;
    directoryError?: string | null;
  }>;
}

interface OptimisticWorkspaceArchiveSnapshot {
  workspace: WorkspaceDescriptor | null;
}

/**
 * The daemon received the archive request and refused it. That is a decision, so
 * the workspace goes back into the sidebar.
 *
 * Failures without this shape (RPC timeout, dropped connection) are undecided:
 * the daemon may have archived the workspace after the client stopped waiting,
 * and on Windows that is the normal case — teardown, git worktree removal and
 * retried directory deletion push a worktree archive past 60s.
 */
class WorkspaceArchiveRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceArchiveRejectedError";
  }
}

/** Archive succeeded; only the on-disk removal failed. Not a reason to restore the workspace. */
export class WorkspaceDirectoryRemovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDirectoryRemovalError";
  }
}

export interface WorkspaceArchiveFailure {
  serverId: string;
  workspaceId: string;
  error: unknown;
}

function isWorkspaceArchiveFailure(error: unknown): error is WorkspaceArchiveFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "serverId" in error &&
    typeof error.serverId === "string" &&
    "workspaceId" in error &&
    typeof error.workspaceId === "string" &&
    "error" in error
  );
}

function hideWorkspaceOptimistically(
  workspace: WorkspaceArchiveTarget,
): OptimisticWorkspaceArchiveSnapshot {
  const workspaces = useSessionStore.getState().sessions[workspace.serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: workspace.workspaceId,
  });
  const snapshot = workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
  markWorkspaceArchivePending({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  getHostRuntimeStore().removeWorkspaceSnapshot(workspace.serverId, workspace.workspaceId);
  return { workspace: snapshot };
}

function restoreOptimisticallyHiddenWorkspace(input: {
  serverId: string;
  workspaceId: string;
  snapshot: OptimisticWorkspaceArchiveSnapshot;
}): void {
  clearWorkspaceArchivePending({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (input.snapshot.workspace) {
    getHostRuntimeStore().acceptWorkspaceSnapshots(input.serverId, [input.snapshot.workspace]);
  }
}

async function archiveWorkspaceOrThrow(input: {
  client: WorkspaceArchiveClient;
  workspaceId: string;
}): Promise<void> {
  const payload = await input.client.archiveWorkspace(input.workspaceId);
  if (payload.error) {
    throw new WorkspaceArchiveRejectedError(payload.error);
  }
  // The archive itself succeeded, but the backing directory could not be
  // deleted (a file handle kept the tree busy on Windows). The workspace is
  // gone from the sidebar either way; surface the residue so the user can act.
  if (payload.directoryError) {
    throw new WorkspaceDirectoryRemovalError(payload.directoryError);
  }
}

/**
 * The archive outcome is unknown: keep the workspace hidden and let the daemon
 * decide. Clearing the pending mark lets the refresh result through, so a
 * workspace the daemon still lists as active comes back on its own.
 */
async function reconcileUndecidedWorkspaceArchive(
  workspace: WorkspaceArchiveTarget,
): Promise<void> {
  clearWorkspaceArchivePending({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  try {
    await getHostRuntimeStore().refreshWorkspaceDirectory({ serverId: workspace.serverId });
  } catch {
    // No live runtime or no connection; the next directory refresh settles it.
  }
}

export async function archiveWorkspaceOptimistically(input: {
  client: WorkspaceArchiveClient;
  workspace: WorkspaceArchiveTarget;
}): Promise<void> {
  const snapshot = hideWorkspaceOptimistically(input.workspace);

  try {
    await archiveWorkspaceOrThrow({
      client: input.client,
      workspaceId: input.workspace.workspaceId,
    });
  } catch (error) {
    if (error instanceof WorkspaceArchiveRejectedError) {
      restoreOptimisticallyHiddenWorkspace({
        serverId: input.workspace.serverId,
        workspaceId: input.workspace.workspaceId,
        snapshot,
      });
    } else if (!(error instanceof WorkspaceDirectoryRemovalError)) {
      await reconcileUndecidedWorkspaceArchive(input.workspace);
    }
    throw error;
  }
}

export async function archiveWorkspacesOptimistically(input: {
  getClient: (serverId: string) => WorkspaceArchiveClient | null;
  workspaces: WorkspaceArchiveTarget[];
}): Promise<WorkspaceArchiveFailure[]> {
  const results = await Promise.allSettled(
    input.workspaces.map(async (workspace) => {
      const client = input.getClient(workspace.serverId);
      if (!client) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error: new Error(i18n.t("sidebar.workspace.toasts.hostDisconnected")),
        } satisfies WorkspaceArchiveFailure;
      }

      try {
        await archiveWorkspaceOptimistically({
          client,
          workspace,
        });
      } catch (error) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error,
        } satisfies WorkspaceArchiveFailure;
      }
    }),
  );

  return results.flatMap((result) =>
    result.status === "rejected" && isWorkspaceArchiveFailure(result.reason) ? [result.reason] : [],
  );
}
