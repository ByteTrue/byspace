import type { WorkspaceLabelDefinition } from "@bytetrue/byspace-protocol/workspace-labels";
import type { PrHint } from "@/git/pr-hint";
import type { SidebarChecksDisplay } from "@/components/sidebar/display-preferences/checks-display";
import type { SidebarRowItems } from "@/components/sidebar/display-preferences/row-items";
import { selectCheckSummary, type CheckSummary } from "./check-summary";
import type { WorkspaceServiceSummary } from "./service-summary";

export type MetaRowItem =
  | { kind: "branch"; name: string }
  | { kind: "project"; name: string }
  | { kind: "host" }
  | { kind: "changeRequest"; hint: PrHint }
  | { kind: "checks"; summary: CheckSummary; label: boolean }
  | { kind: "services"; summary: WorkspaceServiceSummary }
  | { kind: "labels"; labels: readonly WorkspaceLabelDefinition[] };

export function selectMetaRowItems(input: {
  currentBranch: string | null;
  projectName: string | null;
  hasHostBadge: boolean;
  prHint: PrHint | null;
  serviceSummary: WorkspaceServiceSummary | null;
  labels: readonly WorkspaceLabelDefinition[];
  visible: SidebarRowItems;
  checksDisplay: SidebarChecksDisplay;
}): MetaRowItem[] {
  const {
    currentBranch,
    projectName,
    hasHostBadge,
    prHint,
    serviceSummary,
    labels,
    visible,
    checksDisplay,
  } = input;
  const items: MetaRowItem[] = [];

  if (currentBranch && visible.branch) items.push({ kind: "branch", name: currentBranch });
  if (projectName && visible.project) items.push({ kind: "project", name: projectName });
  if (hasHostBadge) items.push({ kind: "host" });
  if (prHint && visible.changeRequest) items.push({ kind: "changeRequest", hint: prHint });
  if (checksDisplay !== "none") {
    const summary = selectCheckSummary(prHint);
    if (summary) items.push({ kind: "checks", summary, label: checksDisplay === "iconAndText" });
  }
  if (serviceSummary && visible.services) items.push({ kind: "services", summary: serviceSummary });
  if (labels.length > 0 && visible.labels) {
    items.push({ kind: "labels", labels });
  }

  return items;
}
