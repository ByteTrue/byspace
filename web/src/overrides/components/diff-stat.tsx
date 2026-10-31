// Override of packages/app/src/components/diff-stat.tsx: "+12 -3" in the status colours.
import { formatDiffCount } from "@/git/file-header-presentation";

export function DiffStat({
  additions,
  deletions,
  testID,
}: {
  additions: number;
  deletions: number;
  testID?: string;
}) {
  return (
    <span className="flex h-5 shrink-0 items-center gap-1 text-xs" data-testid={testID}>
      <span className="text-status-success">+{formatDiffCount(additions)}</span>
      <span className="text-status-danger">-{formatDiffCount(deletions)}</span>
    </span>
  );
}
