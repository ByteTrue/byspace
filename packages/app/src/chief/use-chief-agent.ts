import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";

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

/** Reserved label the daemon stamps on its Home workspace. */
const HOME_WORKSPACE_LABEL = "byspace.home-workspace";

interface WorkspaceLike {
  id: string;
  title?: string | null;
  workspaceDirectory?: string;
  cwd?: string;
  projectRootPath?: string;
  labels?: string[];
}

/** Exported for tests. */
export function isHomeWorkspace(workspace: WorkspaceLike): boolean {
  // The reserved label is the identity, and the only one. Matching titles or
  // paths here would claim a workspace the user opened themselves — a "Home"
  // title, or any directory ending in .byspace — and hang Chief's session off
  // it. The daemon stamps the label on the Home it creates and on nothing else
  // (packages/server/src/server/home-workspace.ts).
  return workspace.labels?.includes(HOME_WORKSPACE_LABEL) === true;
}

/** Pick the first ready provider from the daemon snapshot so Chief follows the
 * user's provider configuration instead of a hard-coded provider. */
/** Exported for tests. */
export async function resolveChiefProvider(
  client: Pick<DaemonClient, "getProvidersSnapshot">,
): Promise<AgentProvider | null> {
  const snapshot = await client.getProvidersSnapshot({});
  const entry = snapshot.entries.find((e) => e.enabled && e.status === "ready");
  return entry?.provider ?? null;
}

/** Exported for tests. */
export async function findChiefAgent(
  client: Pick<DaemonClient, "fetchAgents">,
  homeWorkspaceId: string,
): Promise<ChiefAgentInfo | null> {
  const result = await client.fetchAgents({
    filter: { labels: { "byspace.agent-role": "chief" } },
    page: { limit: 50 },
  });
  // Only a Chief agent in the Home workspace owns the floating window; a chief
  // role session started elsewhere (e.g. via the CLI) must not be picked up.
  const entry = result.entries.find((e) => e.agent.workspaceId === homeWorkspaceId);
  if (!entry) return null;
  const agent = entry.agent;
  return { agentId: agent.id, workspaceId: homeWorkspaceId, cwd: agent.cwd };
}

async function createChiefAgent(
  client: DaemonClient,
  workspaceId: string,
  cwd: string,
): Promise<ChiefAgentInfo> {
  const provider = await resolveChiefProvider(client);
  if (!provider) {
    throw new Error("No ready agent provider found on the daemon");
  }
  const snapshot = await client.createAgent({
    provider,
    cwd,
    workspaceId,
    config: { provider, cwd, role: "chief" },
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
export function useChiefAgent(
  serverId: string | null,
  options?: { enabled?: boolean; retryCount?: number },
): ChiefAgentState {
  const enabled = options?.enabled ?? true;
  const retryCount = options?.retryCount ?? 0;
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
  // Guarded by the serverId the last resolve ran against (not a sentinel), so
  // host switches re-resolve and the floating window always tracks the host
  // that actually owns the connection.
  const resolvedServerIdRef = useRef<string | null>(null);

  const resolve = useCallback(async () => {
    if (!effectiveClient || !effectiveServerId) return;
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
        setState({ tag: "ready", agent: existing, serverId: effectiveServerId });
        return;
      }
      const created = await createChiefAgent(effectiveClient, home.id, cwd);
      setState({ tag: "ready", agent: created, serverId: effectiveServerId });
    } catch (error) {
      // Allow a later enabled/serverId change to retry instead of locking the
      // error state in.
      if (resolvedServerIdRef.current === effectiveServerId) {
        resolvedServerIdRef.current = null;
      }
      setState({
        tag: "error",
        message: error instanceof Error ? error.message : "Failed to set up Chief",
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [effectiveClient, effectiveServerId]);

  const lastRetryRef = useRef(-1);
  useEffect(() => {
    if (!enabled) return;
    if (!isClientReady) return;
    if (lastRetryRef.current === retryCount) return;
    lastRetryRef.current = retryCount;
    if (resolvedServerIdRef.current === effectiveServerId) return;
    resolvedServerIdRef.current = effectiveServerId;
    setState({ tag: "loading" });
    void resolve();
  }, [enabled, isClientReady, effectiveServerId, retryCount, resolve]);

  return state;
}
