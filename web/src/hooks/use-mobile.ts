import { useIsCompactFormFactor } from "@/constants/layout";

// BySpace: shadcn's sidebar asks this hook when to become a sheet. Answer with the app's compact
// breakpoint (720px, Tailwind's `md` is set to match in index.css) so the two never disagree.
export function useIsMobile(): boolean {
  return useIsCompactFormFactor();
}
