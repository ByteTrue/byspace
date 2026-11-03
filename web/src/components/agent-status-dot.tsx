import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@bytetrue/protocol/agent-lifecycle";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { cn } from "cn";

const DOT_CLASS: Record<SidebarStateBucket, string | null> = {
  needs_input: "bg-status-dot-warning",
  failed: "bg-status-dot-danger",
  running: "bg-status-dot-running",
  attention: "bg-status-dot-success",
  done: null,
};

function isAgentLifecycleStatus(value: string): value is AgentLifecycleStatus {
  return AGENT_LIFECYCLE_STATUSES.some((status) => status === value);
}

/** The Expo app's AgentStatusDot: the agent's sidebar bucket as a 6px dot. */
export function AgentStatusDot({
  status,
  requiresAttention,
  attentionReason,
  pendingPermissionCount,
  showInactive = false,
}: {
  status: string | null | undefined;
  requiresAttention: boolean | null | undefined;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissionCount?: number;
  showInactive?: boolean;
}) {
  if (!status || !isAgentLifecycleStatus(status)) return null;
  const bucket = deriveSidebarStateBucket({
    status,
    requiresAttention: Boolean(requiresAttention),
    attentionReason: attentionReason ?? null,
    pendingPermissionCount: pendingPermissionCount ?? 0,
  });
  const dot = bucket === "done" && showInactive ? "bg-border" : DOT_CLASS[bucket];
  if (!dot) return null;
  return <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />;
}
