import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { Href } from "expo-router";
import {
  buildHostRootRoute,
  buildHostWorkspaceRoute,
  buildOpenProjectRoute,
} from "@/utils/host-routes";

const WELCOME_ROUTE: Href = "/welcome";

export function shouldRunStartupGiveUpTimer(input: {
  anyOnlineHostServerId: string | null;
  hasGivenUpWaitingForHost: boolean;
}): boolean {
  return !input.anyOnlineHostServerId && !input.hasGivenUpWaitingForHost;
}

export type StartupRegistryStatus = "loading" | "ready";

export interface IndexStartupRouteTarget {
  kind: "index";
  pathname: string;
}

export interface HostStartupRouteTarget {
  kind: "host";
  serverId: string | null;
}

export type StartupRouteTarget = IndexStartupRouteTarget | HostStartupRouteTarget;

interface ResolveStartupRouteBaseInput {
  hostRegistryStatus: StartupRegistryStatus;
  hosts: readonly { serverId: string }[];
}

export interface ResolveIndexStartupRouteInput extends ResolveStartupRouteBaseInput {
  route: IndexStartupRouteTarget;
  anyOnlineHostServerId: string | null;
  workspaceSelection: ActiveWorkspaceSelection | null;
  workspaceSelectionStatus: WorkspaceSelectionStatus;
  isWorkspaceSelectionLoaded: boolean;
  hasGivenUpWaitingForHost: boolean;
}

export interface ResolveHostStartupRouteInput extends ResolveStartupRouteBaseInput {
  route: HostStartupRouteTarget;
}

export type ResolveStartupRouteInput = ResolveIndexStartupRouteInput | ResolveHostStartupRouteInput;

export type StartupRouteDecision =
  | { kind: "render" }
  | { kind: "splash" }
  | { kind: "redirect"; href: Href };

export type WorkspaceSelectionStatus = "unknown" | "exists" | "missing";

function shouldRestoreWorkspaceSelection(input: {
  workspaceSelection: ActiveWorkspaceSelection | null;
  workspaceSelectionStatus: WorkspaceSelectionStatus;
}): input is {
  workspaceSelection: ActiveWorkspaceSelection;
  workspaceSelectionStatus: Exclude<WorkspaceSelectionStatus, "missing">;
} {
  return input.workspaceSelection !== null && input.workspaceSelectionStatus !== "missing";
}

export function resolveWorkspaceSelectionStatus(input: {
  hasHydratedWorkspaces: boolean;
  workspaceExists: boolean;
}): WorkspaceSelectionStatus {
  if (input.workspaceExists) {
    return "exists";
  }
  return input.hasHydratedWorkspaces ? "missing" : "unknown";
}

export function resolveHostIndexRoute(input: {
  serverId: string;
  workspaceSelection: ActiveWorkspaceSelection | null;
  workspaceSelectionStatus: WorkspaceSelectionStatus;
}): Href {
  if (
    input.workspaceSelection?.serverId === input.serverId &&
    shouldRestoreWorkspaceSelection(input)
  ) {
    return buildHostWorkspaceRoute(input.serverId, input.workspaceSelection.workspaceId);
  }
  return buildOpenProjectRoute();
}

function isIndexPathname(pathname: string) {
  return pathname === "/" || pathname === "";
}

function hostExists(hosts: readonly { serverId: string }[], serverId: string | null): boolean {
  if (!serverId) {
    return false;
  }
  return hosts.some((host) => host.serverId === serverId);
}

function resolveReadyIndexStartupRoute(input: ResolveIndexStartupRouteInput): StartupRouteDecision {
  if (!isIndexPathname(input.route.pathname)) {
    return { kind: "render" };
  }

  if (!input.isWorkspaceSelectionLoaded) {
    return { kind: "splash" };
  }

  if (
    shouldRestoreWorkspaceSelection(input) &&
    hostExists(input.hosts, input.workspaceSelection.serverId)
  ) {
    // Native cold launch must enter the host boundary first. The host index
    // owns workspace restore after its local dynamic params exist.
    return {
      kind: "redirect",
      href: buildHostRootRoute(input.workspaceSelection.serverId),
    };
  }

  if (input.anyOnlineHostServerId) {
    return { kind: "redirect", href: buildHostRootRoute(input.anyOnlineHostServerId) };
  }

  const savedHostServerId = input.hosts[0]?.serverId ?? null;
  if (savedHostServerId) {
    return { kind: "redirect", href: buildHostRootRoute(savedHostServerId) };
  }

  if (input.hasGivenUpWaitingForHost) {
    return { kind: "redirect", href: WELCOME_ROUTE };
  }

  return { kind: "splash" };
}

function resolveReadyHostStartupRoute(input: ResolveHostStartupRouteInput): StartupRouteDecision {
  if (hostExists(input.hosts, input.route.serverId)) {
    return { kind: "render" };
  }

  const fallbackServerId = input.hosts[0]?.serverId ?? null;
  if (fallbackServerId) {
    return { kind: "redirect", href: buildOpenProjectRoute() };
  }

  return { kind: "redirect", href: WELCOME_ROUTE };
}

function isHostStartupRouteInput(
  input: ResolveStartupRouteInput,
): input is ResolveHostStartupRouteInput {
  return input.route.kind === "host";
}

export function resolveStartupRoute(input: ResolveStartupRouteInput): StartupRouteDecision {
  if (isHostStartupRouteInput(input)) {
    if (input.hostRegistryStatus === "loading") {
      return { kind: "render" };
    }
    return resolveReadyHostStartupRoute(input);
  }

  if (input.hostRegistryStatus === "loading") {
    return { kind: "splash" };
  }

  return resolveReadyIndexStartupRoute(input);
}
