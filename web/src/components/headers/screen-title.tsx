// Port of archive/expo-app:packages/app/src/components/headers/screen-title.tsx: 14px medium, one line.
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
      className={cn(
        // The Expo app sets no line height (normal); text-sm alone would make the line 20px.
        "min-w-0 shrink truncate text-sm leading-[normal] font-medium text-foreground",
        className,
      )}
      style={style}
      data-testid={testID}
    >
      {children}
    </span>
  );
}
