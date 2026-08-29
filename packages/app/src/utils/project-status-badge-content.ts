import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export type ProjectStatusBadgeContent =
  | { kind: "alert" }
  | { kind: "dot"; bucket: "failed" | "attention" | "running" };

export function getProjectStatusBadgeContent(
  statusBucket: SidebarStateBucket | null,
): ProjectStatusBadgeContent | null {
  if (statusBucket === "needs_input") return { kind: "alert" };
  if (statusBucket === "failed" || statusBucket === "attention" || statusBucket === "running") {
    return { kind: "dot", bucket: statusBucket };
  }
  return null;
}
