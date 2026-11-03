// Port of archive/expo-app:packages/app/src/composer/diff-stat-pill.tsx: the workspace's uncommitted line counts
// above the composer; pressing opens the Changes tab.
import { memo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { composerPillClassName } from "@/composer/pill-styles";
import { useVisibleWorkspaceDiffStat } from "@/composer/workspace-diff-stat";

export function ComposerDiffStatPill({
  additions,
  deletions,
  onPress,
}: {
  additions: number;
  deletions: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="composer-diff-stat-pill"
      aria-label={t("workspace.git.diff.openChangesTab")}
      onClick={onPress}
      className={composerPillClassName(false, "pointer-events-auto hover:bg-muted")}
    >
      <DiffStat additions={additions} deletions={deletions} />
    </button>
  );
}

export const WorkspaceDiffStatPill = memo(function WorkspaceDiffStatPill({
  serverId,
  workspaceId,
  onPress,
}: {
  serverId: string;
  workspaceId: string;
  onPress: () => void;
}): ReactElement | null {
  const diffStat = useVisibleWorkspaceDiffStat(serverId, workspaceId);
  if (!diffStat) return null;
  return (
    <ComposerDiffStatPill
      additions={diffStat.additions}
      deletions={diffStat.deletions}
      onPress={onPress}
    />
  );
});
