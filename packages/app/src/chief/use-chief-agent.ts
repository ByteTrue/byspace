import { useCallback, useEffect, useRef, useState } from "react";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
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

interface WorkspaceLike {
  title?: string | null;
  workspaceDirectory?: string;
  cwd?: string;
  projectRootPath?: string;
}

function isHomeWorkspace(workspace: WorkspaceLike): boolean {
  if (workspace.title === HOME_WORKSPACE_TITLE) return true;
  const dir = workspace.workspaceDirectory ?? workspace.cwd ?? workspace.projectRootPath ?? "";
  const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
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
 * agent. Fetches workspaces directly from the daemon because the replica
 * store may not have synced the Home workspace yet.
 */
export function useChiefAgent(serverId: string | null): ChiefAgentState {
  const store = getHostRuntimeStore();
  const hosts = store.getHosts();
  const client = useHostRuntimeClient(serverId ?? "");
  // The URL host may hold an expired serverId (daemon restarts generate a
  // new one). Fall back to any host that has a live client.
  const effectiveClient =
    client ?? hosts.map((h) => store.getClient(h.serverId)).find((c) => c !== null) ?? null;
  const isClientReady = effectiveClient !== null;

  const [state, setState] = useState<ChiefAgentState>({ tag: "loading" });
  const inFlightRef = useRef(false);
  const resolvedServerIdRef = useRef<string | null>(null);

  const resolve = useCallback(async () => {
    if (!effectiveClient) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const workspaces = await effectiveClient.fetchWorkspaces();
      const home = workspaces.entries.find((entry) => isHomeWorkspace(entry));
      if (!home) {
        setState({ tag: "no_home_workspace" });
        return;
      }
      const cwd = home.workspaceDirectory ?? home.projectRootPath;
      const existing = await findChiefAgent(effectiveClient, home.id);
      if (existing) {
        setState({ tag: "ready", agent: existing });
        return;
      }
      const created = await createChiefAgent(effectiveClient, home.id, cwd);
      setState({ tag: "ready", agent: created });
    } catch (error) {
      setState({
        tag: "error",
        message: error instanceof Error ? error.message : "Failed to set up Chief",
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [effectiveClient]);

  useEffect(() => {
    if (!isClientReady) return;
    if (resolvedServerIdRef.current) return;
    resolvedServerIdRef.current = "__resolved__";
    setState({ tag: "loading" });
    void resolve();
  }, [isClientReady, resolve]);

  return state;
}
