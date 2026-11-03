// Port of packages/app/src/workspace-labels/command-center-icon.tsx: the label's colour dot,
// one stable component per colour.
import type { WorkspaceLabelColor } from "@bytetrue/protocol/workspace-labels";
import type { CommandCenterIcon } from "@/command-center/contributions";
// Through `@/` so the dot is the ported swatch: TypeScript resolves the Expo file's relative
// `./swatch` to the Expo original.
import { WorkspaceLabelDot } from "@/workspace-labels/swatch";

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
