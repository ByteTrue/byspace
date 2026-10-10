import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";

export interface ChiefAgentInfo {
  agentId: string;
  workspaceId: string;
  cwd: string;
}

export type ChiefAgentState =
  | { tag: "loading" }
  | { tag: "ready"; agent: ChiefAgentInfo }
  | { tag: "no_home_workspace" }
  | { tag: "error"; message: string };

const HOME_WORKSPACE_TITLE = "Home";
const HOME_DIR_NAME = ".byspace";

function isHomeWorkspace(workspace: {
  title?: string | null;
  workspaceDirectory: string;
}): boolean {
  if (workspace.title === HOME_WORKSPACE_TITLE) return true;
  const normalized = workspace.workspaceDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.endsWith("/" + HOME_DIR_NAME);
}

async function findChiefAgent(
  client: DaemonClient,
  workspaceId: string,
): Promise<ChiefAgentInfo | null> {
  const result = await client.fetchAgents({
    filter: { labels: { "byspace.agent-role": "chief" } },
    page: { limit: 1 },
  });
  const entry = result.entries[0];
  if (!entry) return null;
  const agent = entry.agent;
  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId ?? workspaceId,
    cwd: agent.cwd,
  };
}

async function createChiefAgent(
  client: DaemonClient,
  workspaceId: string,
  cwd: string,
): Promise<ChiefAgentInfo> {
  const snapshot = await client.createAgent({
    provider: "pi",
    cwd,
    workspaceId,
    config: { provider: "pi", cwd, role: "chief" },
  });
  return { agentId: snapshot.id, workspaceId, cwd };
}

/**
 * Find or create the Chief agent on the given host. The Home workspace must
 * already exist (daemon auto-creates it at boot); this hook only handles the
 * agent.
 */
export function useChiefAgent(serverId: string | null): ChiefAgentState {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const workspaces = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.workspaces : undefined,
  );
  const [state, setState] = useState<ChiefAgentState>({ tag: "loading" });
  const inFlightRef = useRef(false);

  const homeWorkspace = useMemo(() => {
    if (!workspaces) return null;
    for (const ws of workspaces.values()) {
      if (isHomeWorkspace(ws)) return ws;
    }
    return null;
  }, [workspaces]);

  const resolve = useCallback(async () => {
    if (!client || !isConnected || !homeWorkspace) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const existing = await findChiefAgent(client, homeWorkspace.id);
      if (existing) {
        setState({ tag: "ready", agent: existing });
        return;
      }
      const created = await createChiefAgent(
        client,
        homeWorkspace.id,
        homeWorkspace.workspaceDirectory,
      );
      setState({ tag: "ready", agent: created });
    } catch (error) {
      setState({
        tag: "error",
        message: error instanceof Error ? error.message : "Failed to set up Chief",
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [client, isConnected, homeWorkspace]);

  useEffect(() => {
    if (!serverId || !isConnected || !homeWorkspace) {
      if (!homeWorkspace && workspaces && workspaces.size > 0) {
        setState({ tag: "no_home_workspace" });
      }
      return;
    }
    void resolve();
  }, [serverId, isConnected, homeWorkspace, workspaces, resolve]);

  return state;
}
