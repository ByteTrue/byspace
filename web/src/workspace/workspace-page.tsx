import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useShallow } from "zustand/shallow";
import { selectWorkspaceAgents } from "@/hooks/sidebar-workspaces-view-model";
import { useSessionStore } from "@/stores/session-store";
import { decodeWorkspaceIdFromPathSegment } from "@/utils/host-routes";
import { AgentComposer } from "~/agent/agent-composer";
import { AgentConversation } from "~/agent/agent-conversation";
import { HomePage } from "~/app/home-page";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

export function WorkspacePage() {
  const params = useParams();
  const serverId = params.serverId ?? "";
  const workspaceId = params.workspaceId
    ? decodeWorkspaceIdFromPathSegment(params.workspaceId)
    : null;
  const workspace = useSessionStore((state) =>
    workspaceId ? state.sessions[serverId]?.workspaces.get(workspaceId) : undefined,
  );
  const agents = useSessionStore(
    useShallow((state) =>
      workspaceId
        ? selectWorkspaceAgents({ agents: state.sessions[serverId]?.agents, serverId, workspaceId })
        : [],
    ),
  );
  const tabs = useMemo(
    () => [...agents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    [agents],
  );
  const mostRecent = useMemo(
    () =>
      agents.reduce<(typeof agents)[number] | null>(
        (latest, agent) =>
          !latest || agent.lastActivityAt.getTime() > latest.lastActivityAt.getTime()
            ? agent
            : latest,
        null,
      ),
    [agents],
  );
  // shortcut: the open tab lives in component state; tab persistence and the `?open=` intent
  // arrive with the workspace tab model in step 3 of the rewrite epic.
  const [selected, setSelected] = useState<{ workspaceId: string | null; agentId: string } | null>(
    null,
  );
  const agentId =
    (selected?.workspaceId === workspaceId && tabs.some((agent) => agent.id === selected.agentId)
      ? selected.agentId
      : mostRecent?.id) ?? null;
  const selectTab = useCallback(
    (value: string) => setSelected({ workspaceId, agentId: value }),
    [workspaceId],
  );

  if (!workspaceId) return <HomePage />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
        <span className="truncate text-sm font-medium">{workspace?.name ?? "Workspace"}</span>
        {workspace ? (
          <span className="truncate text-sm text-muted-foreground">
            {workspace.projectDisplayName}
          </span>
        ) : null}
      </header>
      {tabs.length > 0 ? (
        <Tabs
          value={agentId ?? undefined}
          onValueChange={selectTab}
          className="shrink-0 border-b px-3"
        >
          <TabsList variant="line" className="h-10">
            {tabs.map((agent) => (
              <TabsTrigger key={agent.id} value={agent.id} className="max-w-56">
                <span className="truncate">{agent.title || "New agent"}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {agentId ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentConversation serverId={serverId} agentId={agentId} />
          <AgentComposer serverId={serverId} agentId={agentId} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No agents in this workspace yet.
        </div>
      )}
    </div>
  );
}
