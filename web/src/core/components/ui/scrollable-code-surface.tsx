// Port of packages/app/src/components/ui/scrollable-code-surface.tsx: a bordered card, and a
// scrolling monospace block in one (both directions by default) for diagnostics and logs. Same
// props; style props take CSS.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { cn } from "cn";

type CodeSurfaceTone = "surface0" | "surface1" | "surface2";

const TONE: Record<CodeSurfaceTone, string> = {
  surface0: "bg-background",
  surface1: "bg-card",
  surface2: "bg-muted",
};

interface SurfaceCardProps {
  children: ReactNode;
  tone?: CodeSurfaceTone;
  bordered?: boolean;
  style?: CSSProperties;
  className?: string;
  testID?: string;
  accessibilityLabel?: string;
  codeSurface?: boolean;
}

export function SurfaceCard({
  children,
  tone = "surface1",
  bordered = true,
  style,
  className,
  testID,
  accessibilityLabel,
  codeSurface = false,
}: SurfaceCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden",
        TONE[tone],
        bordered && "rounded-[10px] border",
        codeSurface && "code-surface",
        className,
      )}
      style={style}
      data-testid={testID}
      aria-label={accessibilityLabel}
      role={accessibilityLabel != null ? "group" : undefined}
    >
      {children}
    </div>
  );
}

interface ScrollableCodeSurfaceProps {
  children: ReactNode;
  maxHeight?: number;
  horizontal?: boolean;
  selectable?: boolean;
  tone?: CodeSurfaceTone;
  bordered?: boolean;
  style?: CSSProperties;
  scrollStyle?: CSSProperties;
  contentContainerStyle?: CSSProperties;
  textStyle?: CSSProperties;
  testID?: string;
  accessibilityLabel?: string;
}

export function ScrollableCodeSurface({
  children,
  maxHeight,
  horizontal = true,
  selectable = true,
  tone = "surface1",
  bordered = true,
  style,
  scrollStyle,
  contentContainerStyle,
  textStyle,
  testID,
  accessibilityLabel,
}: ScrollableCodeSurfaceProps) {
  const outerScrollStyle = useMemo(() => ({ maxHeight, ...scrollStyle }), [maxHeight, scrollStyle]);
  const text = cn(
    "font-mono text-[length:var(--code-font-size)] leading-[18px] text-foreground",
    horizontal ? "[overflow-wrap:normal] whitespace-pre" : "break-words whitespace-pre-wrap",
    selectable ? "select-text" : "select-none",
  );
  return (
    <SurfaceCard
      tone={tone}
      bordered={bordered}
      className="min-h-0 shrink"
      style={style}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      codeSurface
    >
      {/* As packages/app: the vertical scroll holds the padded content, and the horizontal scroll
          sits inside that padding, so long lines clip 16px short of the card's edge. */}
      <div className="min-h-0 shrink overflow-y-auto" style={outerScrollStyle}>
        <div className="px-4 py-3" style={contentContainerStyle}>
          {horizontal ? (
            <div className="overflow-x-auto">
              <div className={text} style={textStyle}>
                {children}
              </div>
            </div>
          ) : (
            <div className={text} style={textStyle}>
              {children}
            </div>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}
