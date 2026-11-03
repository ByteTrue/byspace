import { useSessionStore } from "@/stores/session-store";
import { resolveAgentRoleNames } from "@/agent-controls/roles";

/**
 * The built-in roles the host offers, read straight from `server_info`.
 * Empty means the host has no role feature (or none configured), which is what
 * callers use to hide role UI — see `resolveAgentRoleNames` for the fallback.
 */
export function useHostAgentRoleNames(serverId: string | null | undefined): readonly string[] {
  const serverFeatures = useSessionStore((state) => {
    const normalized = serverId?.trim();
    if (!normalized) return undefined;
    return state.sessions[normalized]?.serverInfo?.features;
  });
  return resolveAgentRoleNames(serverFeatures) ?? EMPTY_AGENT_ROLE_NAMES;
}

const EMPTY_AGENT_ROLE_NAMES: readonly string[] = [];
