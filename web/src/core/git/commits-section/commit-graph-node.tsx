// Port of archive/expo-app:packages/app/src/git/commits-section/commit-graph-node.tsx: the commit's dot on the
// branch rail — accent for the workspace's own commits, muted for base, hollow until pushed.
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { cn } from "cn";

interface CommitGraphNodeProps {
  commit: ClassifiedCheckoutCommit;
  isFirst: boolean;
  isLast: boolean;
}

export function CommitGraphNode({ commit, isFirst, isLast }: CommitGraphNodeProps) {
  const isOnBase = commit.isOnBase;
  return (
    <span className="relative flex w-2 shrink-0 items-center justify-center self-stretch">
      {isFirst && isLast ? null : (
        <span
          className={cn(
            // The row's 4px padding plus 1px, so rails of adjacent rows meet.
            "absolute -top-[5px] -bottom-[5px] w-0.5",
            isOnBase ? "bg-muted-foreground" : "bg-primary",
            isFirst && "top-1/2",
            isLast && "bottom-1/2",
          )}
        />
      )}
      <span
        data-testid={commit.isOnRemote ? "commit-dot-remote" : "commit-dot-local"}
        className={cn(
          "z-1 size-2 rounded-full border-2",
          isOnBase ? "border-muted-foreground bg-muted-foreground" : "border-primary bg-primary",
          !commit.isOnRemote && "bg-background",
        )}
      />
    </span>
  );
}
