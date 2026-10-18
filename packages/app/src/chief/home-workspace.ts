import { resolveAgentRoleNames } from "@/agent-controls/roles";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
} from "@/utils/host-routes";
import { aggregateSidebarStateBuckets, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";

/** Reserved label the daemon stamps on its Home workspace. */
export const HOME_WORKSPACE_LABEL = "byspace.home-workspace";

export const CHIEF_ROLE_NAME = "chief";

export interface HomeWorkspaceCandidate {
  id: string;
  labels?: readonly string[] | null;
}

/**
 * The reserved label is the identity, and the only one. Matching titles or
 * paths here would claim a workspace the user opened themselves — a "Chief" or
 * "Home" title, or any directory ending in .byspace — and treat it as the
 * daemon-managed Home workspace.
 */
export function isHomeWorkspace(
  workspace: { labels?: readonly string[] | null } | null | undefined,
): boolean {
  return workspace?.labels?.includes(HOME_WORKSPACE_LABEL) === true;
}

export function hasHostChiefRole(features: Parameters<typeof resolveAgentRoleNames>[0]): boolean {
  return resolveAgentRoleNames(features)?.includes(CHIEF_ROLE_NAME) === true;
}

export function findHomeWorkspaceId(
  workspaces: Iterable<HomeWorkspaceCandidate> | null | undefined,
): string | null {
  if (!workspaces) return null;
  for (const workspace of workspaces) {
    if (isHomeWorkspace(workspace)) {
      return workspace.id;
    }
  }
  return null;
}

export function resolveChiefTargetServerId(input: {
  pathname?: string | null;
  hostServerIds: readonly string[];
  earliestOnlineServerId?: string | null;
  isChiefSupported?: (serverId: string) => boolean;
}): string | null {
  const { pathname, hostServerIds, earliestOnlineServerId, isChiefSupported } = input;
  const pathServerId = pathname ? parseServerIdFromPathname(pathname) : null;
  const candidates: string[] = [];

  if (pathServerId && hostServerIds.includes(pathServerId)) {
    candidates.push(pathServerId);
  }
  if (
    earliestOnlineServerId &&
    hostServerIds.includes(earliestOnlineServerId) &&
    !candidates.includes(earliestOnlineServerId)
  ) {
    candidates.push(earliestOnlineServerId);
  }
  for (const serverId of hostServerIds) {
    if (!candidates.includes(serverId)) {
      candidates.push(serverId);
    }
  }

  if (isChiefSupported) {
    const supported = candidates.find((serverId) => isChiefSupported(serverId));
    if (supported) return supported;
  }

  return candidates[0] ?? pathServerId ?? null;
}

/**
 * Whether any connected host offers the built-in Chief role.
 *
 * Same global capability gate as `useTunnelsAvailable`: the sidebar entry and
 * command center action have no single host to ask, so they show when at least
 * one host can serve Chief.
 */
export function useChiefAvailable(): boolean {
  return useSessionStore((state) => {
    const serverIds = Object.keys(state.sessions);
    return serverIds.some((serverId) =>
      hasHostChiefRole(state.sessions[serverId]?.serverInfo?.features),
    );
  });
}

export function useIsShowingChiefWorkspace(pathname: string): boolean {
  const routeSelection = parseHostWorkspaceRouteFromPathname(pathname);
  return useSessionStore((state) => {
    if (!routeSelection) return false;
    const workspaces = state.sessions[routeSelection.serverId]?.workspaces;
    const key = resolveWorkspaceMapKeyByIdentity({
      workspaces,
      workspaceId: routeSelection.workspaceId,
    });
    const workspace = key ? workspaces?.get(key) : undefined;
    return isHomeWorkspace(workspace);
  });
}

export function deriveHomeWorkspaceStatusBucket(input: {
  workspace: Pick<WorkspaceDescriptor, "id" | "status"> | null | undefined;
  workspaceAgentActivity?: ReadonlyMap<string, Pick<WorkspaceAgentActivity, "status">>;
}): SidebarStateBucket {
  if (!input.workspace) return "done";
  if (input.workspace.status !== "done") {
    return input.workspace.status;
  }
  const rootAgentActivity = input.workspaceAgentActivity?.get(input.workspace.id);
  if (rootAgentActivity && rootAgentActivity.status !== "done") {
    return rootAgentActivity.status;
  }
  return "done";
}

interface CachedSessionHomeStatus {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  workspaceAgentActivity: ReadonlyMap<string, WorkspaceAgentActivity>;
  bucket: SidebarStateBucket | null;
}

const sessionHomeStatusCache = new WeakMap<object, CachedSessionHomeStatus>();

function selectSessionHomeStatusBucket(session: {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  workspaceAgentActivity: ReadonlyMap<string, WorkspaceAgentActivity>;
}): SidebarStateBucket | null {
  const cached = sessionHomeStatusCache.get(session.workspaces);
  if (
    cached &&
    cached.workspaces === session.workspaces &&
    cached.workspaceAgentActivity === session.workspaceAgentActivity
  ) {
    return cached.bucket;
  }

  let bucket: SidebarStateBucket | null = null;
  for (const workspace of session.workspaces.values()) {
    if (isHomeWorkspace(workspace)) {
      bucket = deriveHomeWorkspaceStatusBucket({
        workspace,
        workspaceAgentActivity: session.workspaceAgentActivity,
      });
      break;
    }
  }

  sessionHomeStatusCache.set(session.workspaces, {
    workspaces: session.workspaces,
    workspaceAgentActivity: session.workspaceAgentActivity,
    bucket,
  });
  return bucket;
}

export function useChiefWorkspaceStatusBucket(): SidebarStateBucket {
  return useSessionStore((state) => {
    const buckets: SidebarStateBucket[] = [];
    for (const session of Object.values(state.sessions)) {
      if (!session) continue;
      const bucket = selectSessionHomeStatusBucket(session);
      if (bucket) {
        buckets.push(bucket);
      }
    }
    return aggregateSidebarStateBuckets(buckets);
  });
}

export async function openChiefWorkspace(pathname?: string | null): Promise<boolean> {
  const runtime = getHostRuntimeStore();
  const hosts = runtime.getHosts();
  const sessionState = useSessionStore.getState();

  const serverId = resolveChiefTargetServerId({
    pathname,
    hostServerIds: hosts.map((host) => host.serverId),
    earliestOnlineServerId: runtime.getEarliestOnlineHostServerId(),
    isChiefSupported: (candidateId) =>
      hasHostChiefRole(sessionState.sessions[candidateId]?.serverInfo?.features),
  });
  if (!serverId) return false;

  const cachedHomeId = findHomeWorkspaceId(sessionState.sessions[serverId]?.workspaces?.values());
  if (cachedHomeId) {
    navigateToWorkspace({ serverId, workspaceId: cachedHomeId });
    return true;
  }

  const client = runtime.getClient(serverId);
  if (!client) return false;

  try {
    const result = await client.fetchWorkspaces();
    const fetchedHomeId = findHomeWorkspaceId(result.entries);
    if (!fetchedHomeId) return false;
    navigateToWorkspace({ serverId, workspaceId: fetchedHomeId });
    return true;
  } catch {
    return false;
  }
}
