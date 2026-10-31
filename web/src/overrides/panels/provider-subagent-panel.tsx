// Override of packages/app/src/panels/provider-subagent-panel.tsx: same descriptor.
// shortcut: the subagent transcript moves with the conversation in batch 2 of step 3.
import { getProviderIcon } from "@/components/provider-icons";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import {
  providerSubagentKey,
  providerSubagentLifecycleStatus,
  useProviderSubagentStore,
} from "@/subagents/provider-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { PendingPanel } from "@/panels/pending-panel";

function formatProviderLabel(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function useProviderSubagentDescriptor(
  target: { kind: "provider_subagent"; parentAgentId: string; subagentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const descriptor = useProviderSubagentStore((state) =>
    state.descriptors.get(
      providerSubagentKey(context.serverId, target.parentAgentId, target.subagentId),
    ),
  );
  const parentProvider = useSessionStore(
    (state) => state.sessions[context.serverId]?.agents.get(target.parentAgentId)?.provider,
  );
  const provider = descriptor?.provider ?? parentProvider ?? "agent";
  // The task names the tab; the subagent type is supporting detail beside the provider.
  const subagentType = descriptor?.title?.trim();
  const label = descriptor?.description?.trim() || subagentType || "Subagent";
  const providerLabel = `${formatProviderLabel(provider)} subagent`;
  return {
    label,
    subtitle:
      subagentType && subagentType !== label ? `${subagentType} · ${providerLabel}` : providerLabel,
    tooltip: label,
    titleState: descriptor ? "ready" : "loading",
    icon: getProviderIcon(provider, context.serverId),
    statusBucket: descriptor
      ? deriveSidebarStateBucket({
          status: providerSubagentLifecycleStatus(descriptor.status),
          requiresAttention: descriptor.status === "failed",
        })
      : null,
  };
}

function ProviderSubagentPanel() {
  return <PendingPanel title="Subagent" />;
}

export const providerSubagentPanelRegistration = definePanel("provider_subagent", {
  component: ProviderSubagentPanel,
  useDescriptor: useProviderSubagentDescriptor,
});
