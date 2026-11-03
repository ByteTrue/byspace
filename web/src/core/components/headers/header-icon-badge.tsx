// Port of packages/app/src/components/headers/header-icon-badge.tsx: the non-interactive icon
// slot at the start of a screen header, the size of the header toggle button.
import type { ReactNode } from "react";

export function HeaderIconBadge({ children }: { children: ReactNode }) {
  return <span className="flex size-7 shrink-0 items-center justify-center">{children}</span>;
}
