// Port of archive/expo-app:packages/app/src/git/pull-request-panel/activity-skeleton.tsx: three placeholder
// activity rows on shadcn's pulsing Skeleton (the Expo file animates opacity with Animated).
import { Skeleton } from "~/components/ui/skeleton";

const ROW_KEYS = [0, 1, 2].map((i) => `pr-activity-skeleton-row-${i}`);

export function PrActivitySkeleton() {
  return (
    <div className="flex flex-col gap-3 px-3" data-testid="pr-pane-activity-skeleton">
      {ROW_KEYS.map((key) => (
        <div key={key} className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-3 w-[70%] rounded-sm" />
            <Skeleton className="h-2.5 w-[45%] rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
