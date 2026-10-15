import { resolveAgentRoleNames } from "@/agent-controls/roles";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
} from "@/utils/host-routes";
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
