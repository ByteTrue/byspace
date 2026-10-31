// Override of packages/app/src/command-center/icon.tsx: the same per-icon adapter cache, painting
// with the muted text colour through CSS instead of a Unistyles theme mapping.
import type { AgentControlIcon } from "@/agent-controls/icons";
import type { CommandCenterIcon, CommandCenterIconProps } from "@/command-center/contributions";

const commandCenterIcons = new Map<AgentControlIcon, CommandCenterIcon>();

export function getCommandCenterIcon(Component: AgentControlIcon): CommandCenterIcon {
  const cached = commandCenterIcons.get(Component);
  if (cached) return cached;
  function CommandCenterIconAdapter({ size }: CommandCenterIconProps) {
    return (
      <span className="flex text-muted-foreground">
        <Component size={size} color="currentColor" />
      </span>
    );
  }
  commandCenterIcons.set(Component, CommandCenterIconAdapter);
  return CommandCenterIconAdapter;
}
