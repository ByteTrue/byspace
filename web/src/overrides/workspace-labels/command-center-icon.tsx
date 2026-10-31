// Override of packages/app/src/workspace-labels/command-center-icon.tsx: the label's colour dot,
// one stable component per colour.
import type { WorkspaceLabelColor } from "@bytetrue/protocol/workspace-labels";
import type { CommandCenterIcon } from "@/command-center/contributions";
import { WorkspaceLabelDot } from "~/sidebar/workspace-labels-menu";

const cache = new Map<WorkspaceLabelColor, CommandCenterIcon>();

export function getLabelCommandCenterIcon(color: WorkspaceLabelColor): CommandCenterIcon {
  const cached = cache.get(color);
  if (cached) return cached;
  function LabelCommandCenterIcon() {
    return <WorkspaceLabelDot color={color} />;
  }
  cache.set(color, LabelCommandCenterIcon);
  return LabelCommandCenterIcon;
}
