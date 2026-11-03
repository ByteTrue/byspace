// Port of archive/expo-app:packages/app/src/components/ui/autocomplete-popover.tsx: the autocomplete list
// floating above the composer input, as wide as it, never taller than the space above it. Focus
// stays in the composer, which owns visibility and the keyboard.
//
// Placed as the Expo app places it: by its bottom edge, OFFSET above the input, so a list that
// grows or shrinks as results arrive keeps its bottom where it was; measured before the first paint,
// so it never shows at a stale position; and under the phone's sidebar panel (z-40, below the
// panels' z-50), as the Expo app's portal host sits under it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement, RefObject } from "react";
import { createPortal } from "react-dom";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { SPACING } from "@/styles/theme";

const OFFSET_FROM_ANCHOR = SPACING[3];

interface AnchorRect {
  left: number;
  top: number;
  width: number;
  viewportHeight: number;
}

function sameRect(a: AnchorRect | null, b: AnchorRect | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.left === b.left &&
      a.top === b.top &&
      a.width === b.width &&
      a.viewportHeight === b.viewportHeight)
  );
}

export function AutocompletePopover({
  visible,
  anchorRef,
  options,
  selectedIndex,
  onSelect,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
}: {
  visible: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
}): ReactElement | null {
  const shown = visible && (options.length === 0 || selectedIndex >= 0);
  const [rect, setRect] = useState<AnchorRect | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!shown || !anchor) {
      setRect(null);
      return;
    }
    const box = anchor.getBoundingClientRect();
    const next = {
      left: box.left,
      top: box.top,
      width: box.width,
      viewportHeight: window.innerHeight,
    };
    setRect((previous) => (sameRect(previous, next) ? previous : next));
  }, [anchorRef, shown]);

  // Every render: the input grows as the draft wraps, which moves its top edge.
  useLayoutEffect(measure);

  useEffect(() => {
    if (!shown) return undefined;
    const anchor = anchorRef.current;
    const observer = anchor ? new ResizeObserver(measure) : null;
    if (anchor) observer?.observe(anchor);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchorRef, measure, shown]);

  const style = useMemo<CSSProperties | null>(
    () =>
      rect
        ? {
            left: rect.left,
            width: rect.width,
            bottom: rect.viewportHeight - rect.top + OFFSET_FROM_ANCHOR,
            maxHeight: `calc(${Math.max(0, rect.top - OFFSET_FROM_ANCHOR * 2)}px - env(safe-area-inset-top))`,
          }
        : null,
    [rect],
  );

  if (!shown || !style) return null;
  return createPortal(
    <div
      data-testid="composer-autocomplete-popover"
      className="fixed z-40 flex flex-col outline-none"
      style={style}
    >
      <Autocomplete
        options={options}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingText={loadingText}
        emptyText={emptyText}
      />
    </div>,
    document.body,
  );
}
