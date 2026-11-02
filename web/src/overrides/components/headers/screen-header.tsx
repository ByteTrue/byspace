// Override of packages/app/src/components/headers/screen-header.tsx: the same frame (36px row on
// desktop, 56px plus 8px on a phone, a bottom hairline, left group and right cluster) in DOM.
import type { CSSProperties, ReactNode } from "react";
import { cn } from "cn";

interface ScreenHeaderProps {
  left?: ReactNode;
  right?: ReactNode;
  /** Kept for the shared callers; class names replace React Native styles here. */
  leftStyle?: CSSProperties;
  rightStyle?: CSSProperties;
  leftClassName?: string;
  rightClassName?: string;
  borderless?: boolean;
  onRowLayout?: unknown;
}

export function ScreenHeader({
  left,
  right,
  leftStyle,
  rightStyle,
  leftClassName,
  rightClassName,
  borderless,
}: ScreenHeaderProps) {
  return (
    <div className="shrink-0 pt-[env(safe-area-inset-top)] max-md:pt-[calc(env(safe-area-inset-top)+8px)]">
      <div
        data-wails-drag="true"
        className={cn(
          "relative flex h-14 items-center justify-between border-b px-2 select-none md:h-9 md:px-3",
          borderless && "border-transparent",
        )}
      >
        <div
          className={cn("flex min-w-0 flex-1 items-center gap-2", leftClassName)}
          style={leftStyle}
        >
          {left}
        </div>
        <div className={cn("flex shrink-0 items-center gap-2", rightClassName)} style={rightStyle}>
          {right}
        </div>
      </div>
    </div>
  );
}
