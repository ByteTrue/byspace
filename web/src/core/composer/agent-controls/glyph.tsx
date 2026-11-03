// Port of packages/app/src/composer/agent-controls/glyph.tsx: a fixed square slot for a
// toolbar icon, hidden from assistive tech (the control carries the label).
import type { ReactNode } from "react";
import { cn } from "cn";

export function ComposerToolbarGlyph({ children, size }: { children: ReactNode; size: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none flex shrink-0 items-center justify-center",
        size >= 20 ? "size-5" : "size-4",
      )}
    >
      {children}
    </span>
  );
}
