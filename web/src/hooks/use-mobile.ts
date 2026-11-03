import { useIsCompactFormFactor } from "@/constants/layout";

// BySpace: shadcn's sidebar asks this hook when to become a sheet; the app's compact layout
// answers it, at the same 768px, so the two never disagree.
export function useIsMobile(): boolean {
  return useIsCompactFormFactor();
}
