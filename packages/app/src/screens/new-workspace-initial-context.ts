import { getWorkspaceCreationHosts, type HostProjectListItem } from "@/projects/host-projects";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

export interface NewWorkspaceHostSelectionInput {
  allServerIds: readonly string[];
  routeServerId: string | null | undefined;
  selectedProject: HostProjectListItem | null;
  hostConnectionStatusByServerId: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  workspaceMultiplicityByServerId: ReadonlyMap<string, boolean>;
}

export interface NewWorkspaceHostSelection {
  eligibleServerIds: string[];
  selectedServerId: string;
  requiresHostSelection: boolean;
}

function knownServerId(serverIds: ReadonlySet<string>, serverId: string | null | undefined) {
  const normalized = serverId?.trim() ?? "";
  return normalized && serverIds.has(normalized) ? normalized : null;
}

function resolveProvisionalServerId(input: NewWorkspaceHostSelectionInput): string {
  const serverIds = new Set(input.allServerIds);
  const routeServerId = knownServerId(serverIds, input.routeServerId);
  if (routeServerId) {
    return routeServerId;
  }
  return (
    input.allServerIds.find(
      (serverId) => input.hostConnectionStatusByServerId.get(serverId) === "online",
    ) ??
    input.allServerIds[0] ??
    ""
  );
}

export function resolveNewWorkspaceHostSelection(
  input: NewWorkspaceHostSelectionInput,
): NewWorkspaceHostSelection {
  if (!input.selectedProject) {
    return {
      eligibleServerIds: [],
      selectedServerId: resolveProvisionalServerId(input),
      requiresHostSelection: false,
    };
  }

  const knownServerIds = new Set(input.allServerIds);
  const eligibleServerIds = getWorkspaceCreationHosts({
    project: input.selectedProject,
    workspaceMultiplicityByServerId: input.workspaceMultiplicityByServerId,
  })
    .map((host) => host.serverId)
    .filter((serverId) => knownServerIds.has(serverId));
  const provisionalServerId = eligibleServerIds[0] ?? resolveProvisionalServerId(input);
  const routeServerId = knownServerId(knownServerIds, input.routeServerId);
  if (routeServerId && eligibleServerIds.includes(routeServerId)) {
    return { eligibleServerIds, selectedServerId: routeServerId, requiresHostSelection: false };
  }

  if (eligibleServerIds.length <= 1) {
    return {
      eligibleServerIds,
      selectedServerId: provisionalServerId,
      requiresHostSelection: false,
    };
  }

  return {
    eligibleServerIds,
    selectedServerId: provisionalServerId,
    requiresHostSelection: true,
  };
}
