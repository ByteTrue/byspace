import { GitActionsSplitButton } from "@/git/actions-split-button";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActions } from "@/git/use-actions";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
  /** shadcn's Button size; "sm" in the workspace's 36px header. */
  size?: "default" | "sm";
}

export function WorkspaceActions({ serverId, cwd, size = "default" }: WorkspaceActionsProps) {
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });

  return <GitActionsSplitButton gitActions={gitActions} size={size} />;
}
