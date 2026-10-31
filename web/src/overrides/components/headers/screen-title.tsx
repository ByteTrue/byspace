// Override of packages/app/src/components/headers/screen-title.tsx: 14px medium, one line.
import type { CSSProperties, ReactNode } from "react";
import { cn } from "cn";

interface ScreenTitleProps {
  children: ReactNode;
  numberOfLines?: number;
  testID?: string;
  style?: CSSProperties;
  className?: string;
}

export function ScreenTitle({ children, testID, style, className }: ScreenTitleProps) {
  return (
    <span
      className={cn("min-w-0 shrink truncate text-sm font-medium text-foreground", className)}
      style={style}
      data-testid={testID}
    >
      {children}
    </span>
  );
}
