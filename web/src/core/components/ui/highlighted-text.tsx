// Port of archive/expo-app:packages/app/src/components/ui/highlighted-text.tsx: text with search matches marked; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/sessions-screen.py; edit it directly.
import { useMemo, type ReactElement } from "react";
import { cn } from "cn";
import type { MatchRange } from "@bytetrue/protocol/search/text-match";
import { toHighlightSegments } from "@/components/ui/highlighted-text-segments";

export interface HighlightedTextProps {
  text: string;
  /** Character spans to mark, in order and non-overlapping. */
  ranges?: readonly MatchRange[];
  className?: string;
  /** 1 truncates to one line with an ellipsis, as React Native's numberOfLines. */
  numberOfLines?: number;
  testID?: string;
}

/**
 * Text with some of its characters marked. Used to show why a search result is
 * in the list — the subsequence and typo tiers can match on characters the eye
 * would never find unaided.
 *
 * The mark is a surface tint rather than the accent: it appears many times on a
 * screen, so it has to stay quiet and survive every theme, and the one accent
 * per surface is spoken for.
 */
export function HighlightedText({
  text,
  ranges,
  className,
  numberOfLines,
  testID,
}: HighlightedTextProps): ReactElement {
  // No line height of its own: tailwind-merge drops a leading-* that precedes the caller's text-*.
  const textClassName = cn(numberOfLines === 1 && "truncate", className);
  const segments = useMemo(
    () => (ranges && ranges.length > 0 ? toHighlightSegments(text, ranges) : null),
    [ranges, text],
  );

  if (!segments) {
    return (
      <span className={textClassName} data-testid={testID}>
        {text}
      </span>
    );
  }

  return (
    <span className={textClassName} data-testid={testID}>
      {segments.map((segment) =>
        segment.marked ? (
          <span key={segment.start} className="bg-(--surface-3) text-foreground">
            {segment.text}
          </span>
        ) : (
          <span key={segment.start}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
