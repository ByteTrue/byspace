import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";

export interface ChiefAgentInfo {
  agentId: string;
  workspaceId: string;
  cwd: string;
}

export type ChiefAgentState =
  | { tag: "loading" }
  | { tag: "ready"; agent: ChiefAgentInfo; serverId: string }
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
 * Find or create the Chief agent on the given host. The daemon owns Home
 * workspace creation at boot (disabled under BYSPACE_DISABLE_HOME_WORKSPACE
 * in test harnesses); this hook only resolves the agent. Fetches workspaces
 * directly from the daemon because the replica store may not have synced the
 * Home workspace yet.
 */
export function useChiefAgent(serverId: string | null): ChiefAgentState {
  const store = getHostRuntimeStore();
  const client = useHostRuntimeClient(serverId ?? "");
  // Reactively find the first live client across all hosts. The URL host's
  // serverId may be stale after a daemon restart; the runtime reconciles
  // serverIds on reconnect, and a global listen catches the rekey.
  const subscribeAll = useCallback(
    (onStoreChange: () => void) => store.subscribeAll(onStoreChange),
    [store],
  );
  // The URL host's serverId may be stale after a daemon restart; the runtime
  // rekeys controllers on hello, so the live client may sit under a different
  // serverId than the one in the current URL. Resolve both together so the
  // PaneContext always uses the serverId that actually owns the connection.
  // Return the client instance directly so useSyncExternalStore sees a stable
  // reference across re-renders and doesn't loop.
  const effectiveClient = useSyncExternalStore(
    subscribeAll,
    () => {
      if (serverId && client) return client;
      for (const host of store.getHosts()) {
        const c = store.getClient(host.serverId);
        if (c) return c;
      }
      return null;
    },
    () => null,
  );
  const effectiveServerId = effectiveClient
    ? (store.getHosts().find((h) => store.getClient(h.serverId) === effectiveClient)?.serverId ??
      null)
    : null;
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
        setState({ tag: "ready", agent: existing, serverId: effectiveServerId! });
        return;
      }
      const created = await createChiefAgent(effectiveClient, home.id, cwd);
      setState({ tag: "ready", agent: created, serverId: effectiveServerId! });
    } catch (error) {
      setState({
        tag: "error",
        message: error instanceof Error ? error.message : "Failed to set up Chief",
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [effectiveClient, effectiveServerId]);

  useEffect(() => {
    if (!isClientReady) return;
    if (resolvedServerIdRef.current) return;
    resolvedServerIdRef.current = "__resolved__";
    setState({ tag: "loading" });
    void resolve();
  }, [isClientReady, resolve]);

  return state;
}
