// Port of packages/app/src/git/pull-request-panel/pane-skeleton.tsx: the PR pane while its
// first load is in flight, on shadcn's Skeleton.
import { useTranslation } from "react-i18next";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { PrActivitySkeleton } from "@/git/pull-request-panel/activity-skeleton";
import { Skeleton } from "~/components/ui/skeleton";

const CHECK_ROW_KEYS = [0, 1, 2].map((i) => `pr-pane-skeleton-check-${i}`);

export function PullRequestPaneSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar" data-testid="pr-pane-skeleton">
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-3/4 rounded-sm" />
        <Skeleton className="h-3 w-2/5 rounded-sm" />
      </div>
      <PaneContentToolbar className="flex items-center gap-2 px-3">
        <Skeleton className="h-6 w-24 rounded-lg" />
        <Skeleton className="h-6 w-24 rounded-lg" />
      </PaneContentToolbar>
      <div className="py-2">
        <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
          {t("workspace.git.pr.sections.checks")}
        </p>
        <div className="flex flex-col gap-1">
          {CHECK_ROW_KEYS.map((key) => (
            <div key={key} className="flex min-h-8 items-center gap-2 px-3">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-3/5 rounded-sm" />
            </div>
          ))}
        </div>
      </div>
      <div className="py-2">
        <PrActivitySkeleton />
      </div>
    </div>
  );
}
