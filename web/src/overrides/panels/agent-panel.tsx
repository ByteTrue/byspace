// Override of packages/app/src/panels/agent-panel.tsx. The descriptors are the Expo file's.
// shortcut: the panel body is step 1's conversation and composer until batch 2 of step 3 ports
// the full agent panel (permissions, questions, plans, rewind, attachments, tracks).
import invariant from "tiny-invariant";
import { SquarePen } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getProviderIcon } from "@/components/provider-icons";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { AgentComposer } from "~/agent/agent-composer";
import { AgentConversation } from "~/agent/agent-conversation";
import { PendingPanel } from "@/panels/pending-panel";

function formatProviderLabel(provider: string): string {
  if (!provider) return "Agent";
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") return null;
  const normalized = title.trim();
  if (!normalized || normalized.toLowerCase() === "new agent") return null;
  return normalized;
}

function useAgentPanelDescriptor(
  target: { kind: "agent"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const descriptorState = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[context.serverId];
      const agent =
        session?.agents?.get(target.agentId) ?? session?.agentDetails?.get(target.agentId) ?? null;
      return {
        provider: agent?.provider ?? "codex",
        title: agent?.title ?? null,
        status: agent?.status ?? null,
        pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
        requiresAttention: agent?.requiresAttention ?? false,
        attentionReason: agent?.attentionReason ?? null,
        isTurnActive: selectAgentTurnPresentation(session, target.agentId).isActive,
      };
    }),
  );
  const provider = descriptorState.provider;
  const label = resolveWorkspaceAgentTabLabel(descriptorState.title);
  const icon = getProviderIcon(provider, context.serverId);
  return {
    label: label ?? "",
    subtitle: `${formatProviderLabel(provider)} agent`,
    tooltip: label ?? `${formatProviderLabel(provider)} agent`,
    titleState: label ? "ready" : "loading",
    icon,
    statusBucket: descriptorState.status
      ? deriveSidebarStateBucket({
          status: descriptorState.isTurnActive ? "running" : descriptorState.status,
          pendingPermissionCount: descriptorState.pendingPermissionCount,
          requiresAttention: descriptorState.requiresAttention,
          attentionReason: descriptorState.attentionReason,
        })
      : null,
  };
}

export function useDraftPanelDescriptor(
  target: { kind: "draft"; draftId: string },
  context: { serverId: string },
) {
  const createDescriptorState = useCreateFlowStore(
    useShallow((state) => {
      const pending = state.pendingByDraftId[target.draftId];
      if (pending?.serverId !== context.serverId || pending.lifecycle !== "active") {
        return { isCreating: false, pendingPrompt: null };
      }
      return { isCreating: true, pendingPrompt: pending.text };
    }),
  );
  return buildDraftPanelDescriptor({ ...createDescriptorState, icon: SquarePen });
}

function AgentPanel() {
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "agent", "AgentPanel requires agent target");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentConversation serverId={serverId} agentId={target.agentId} />
      <AgentComposer serverId={serverId} agentId={target.agentId} />
    </div>
  );
}

export function AgentConversationPanel() {
  const { target } = usePaneContext();
  if (target.kind === "draft") return <PendingPanel title="New agent" />;
  if (target.kind === "agent") return <AgentPanel />;
  invariant(false, "AgentConversationPanel requires an agent or draft target");
}

export const agentPanelRegistration = definePanel("agent", {
  component: AgentConversationPanel,
  useDescriptor: useAgentPanelDescriptor,
});
