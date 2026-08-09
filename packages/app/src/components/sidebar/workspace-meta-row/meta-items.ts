import type { PrHint } from "@/git/pr-hint";
import type { SidebarChecksDisplay } from "@/components/sidebar/display-preferences/checks-display";
import type { SidebarRowItems } from "@/components/sidebar/display-preferences/row-items";
import { selectCheckSummary, type CheckSummary } from "./check-summary";
import type { WorkspaceServiceSummary } from "./service-summary";

export type MetaRowItem =
  | { kind: "host" }
  | { kind: "changeRequest"; hint: PrHint }
  | { kind: "checks"; summary: CheckSummary; label: boolean }
  | { kind: "services"; summary: WorkspaceServiceSummary };

export function selectMetaRowItems(input: {
  hasHostBadge: boolean;
  prHint: PrHint | null;
  serviceSummary: WorkspaceServiceSummary | null;
  visible: SidebarRowItems;
  checksDisplay: SidebarChecksDisplay;
}): MetaRowItem[] {
  const { hasHostBadge, prHint, serviceSummary, visible, checksDisplay } = input;
  const items: MetaRowItem[] = [];

  if (hasHostBadge) items.push({ kind: "host" });
  if (prHint && visible.changeRequest) items.push({ kind: "changeRequest", hint: prHint });
  if (checksDisplay !== "none") {
    const summary = selectCheckSummary(prHint);
    if (summary) items.push({ kind: "checks", summary, label: checksDisplay === "iconAndText" });
  }
  if (serviceSummary && visible.services) items.push({ kind: "services", summary: serviceSummary });

  return items;
}
