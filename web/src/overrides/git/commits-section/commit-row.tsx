// Override of packages/app/src/git/commits-section/commit-row.tsx: one commit — graph node, short
// sha, subject, age — opening its diff on press.
import { memo, useCallback } from "react";
import { CommitGraphNode } from "@/git/commits-section/commit-graph-node";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { formatTimeAgo } from "@/utils/time";

interface CommitRowProps {
  commit: ClassifiedCheckoutCommit;
  isFirst: boolean;
  isLast: boolean;
  now: Date;
  onCommitPress: (sha: string) => void;
}

export const CommitRow = memo(function CommitRow({
  commit,
  isFirst,
  isLast,
  now,
  onCommitPress,
}: CommitRowProps) {
  const handlePress = useCallback(() => {
    onCommitPress(commit.sha);
  }, [commit.sha, onCommitPress]);

  return (
    <button
      type="button"
      data-testid={`commit-row-${commit.shortSha}`}
      onClick={handlePress}
      className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-sidebar-accent active:bg-sidebar-accent"
    >
      <CommitGraphNode commit={commit} isFirst={isFirst} isLast={isLast} />
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span className="w-[70px] shrink-0 truncate font-mono text-xs text-muted-foreground">
          {commit.shortSha}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{commit.subject}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatTimeAgo(new Date(commit.authorDate), now)}
      </span>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <ThemedChevron size={14} uniProps={chevronColorMapping} />
      </span>
    </button>
  );
});
