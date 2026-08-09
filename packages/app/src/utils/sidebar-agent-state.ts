import {
  deriveAgentStateBucket,
  type AgentAttentionReason,
  type AgentStateBucketInput,
} from "@bytetrue/byspace-protocol/agent-state-bucket";

export type SidebarStateBucket = "needs_input" | "failed" | "running" | "attention" | "done";
export type SidebarAttentionReason = AgentAttentionReason;

export function deriveSidebarStateBucket(input: AgentStateBucketInput): SidebarStateBucket {
  return deriveAgentStateBucket(input);
}

export function isSidebarActiveAgent(input: AgentStateBucketInput): boolean {
  return deriveSidebarStateBucket(input) !== "done";
}
// Most urgent first when collapsing a project's workspaces into one status badge.
const STATUS_BUCKET_PRIORITY: readonly SidebarStateBucket[] = [
  "needs_input",
  "failed",
  "running",
  "attention",
  "done",
];

export function aggregateSidebarStateBuckets(
  buckets: Iterable<SidebarStateBucket>,
): SidebarStateBucket {
  let bestRank = STATUS_BUCKET_PRIORITY.length - 1;
  for (const bucket of buckets) {
    const rank = STATUS_BUCKET_PRIORITY.indexOf(bucket);
    if (rank !== -1 && rank < bestRank) bestRank = rank;
  }
  return STATUS_BUCKET_PRIORITY[bestRank] ?? "done";
}
