// Port of archive/expo-app:packages/app/src/components/resize-handle.tsx: the 1px divider between split panes.
// A mouse gets a 10px hit area that lights up after 150ms of hover; touch gets a 24×88 grip.
// Both drive the same shared drag model, previewing while moving and committing on release.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { startResizeHandleDrag } from "@/components/resize-handle-drag";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { cn } from "cn";

export interface ResizeHandleProps {
  testID?: string;
  direction: "horizontal" | "vertical";
  hitAreaAlignment?: "center" | "end";
  groupId: string;
  index: number;
  sizes: number[];
  containerSize: number;
  onPreviewResizeSplit: (groupId: string, sizes: number[]) => void;
  onResizeSplit: (groupId: string, sizes: number[]) => void;
}

// Where the hit area sits against the 1px divider: centred on it, or starting at it.
const HIT_AREA_OFFSET = {
  horizontal: { center: "-left-[5px]", end: "left-0" },
  vertical: { center: "-top-[5px]", end: "top-0" },
} as const;
const TOUCH_AREA_OFFSET = {
  horizontal: { center: "-left-3", end: "left-0" },
  vertical: { center: "-top-3", end: "top-0" },
} as const;

function resetWindowHorizontalScroll() {
  if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
}

export function ResizeHandle({
  testID,
  direction,
  hitAreaAlignment = "center",
  groupId,
  index,
  sizes,
  containerSize,
  onPreviewResizeSplit,
  onResizeSplit,
}: ResizeHandleProps) {
  const finePointer = useHasFinePointer();
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlighted = hovered || dragging;
  const horizontal = direction === "horizontal";

  useEffect(
    () => () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (containerSize <= 0 || event.button !== 0) return;
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const start = horizontal ? event.clientX : event.clientY;
      const size = containerSize;
      const drag = startResizeHandleDrag({
        sizes,
        index,
        preview: (next) => onPreviewResizeSplit(groupId, next),
        commit: (next) => onResizeSplit(groupId, next),
      });
      const cursorBefore = document.body.style.cursor;
      document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
      setDragging(true);
      event.preventDefault();
      event.stopPropagation();
      target.setPointerCapture?.(pointerId);
      resetWindowHorizontalScroll();

      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        resetWindowHorizontalScroll();
        const current = horizontal ? moveEvent.clientX : moveEvent.clientY;
        drag.move((current - start) / size);
      };
      const handleUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        drag.finish();
        document.body.style.cursor = cursorBefore;
        if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
        setDragging(false);
        resetWindowHorizontalScroll();
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [containerSize, groupId, horizontal, index, onPreviewResizeSplit, onResizeSplit, sizes],
  );

  const handlePointerEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setHovered(true), 150);
  }, []);
  const handlePointerLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHovered(false);
  }, []);

  const alignEnd = hitAreaAlignment === "end";
  return (
    <div
      className={cn(
        "relative z-10 shrink-0 bg-border",
        horizontal ? "w-px self-stretch" : "h-px w-full",
      )}
      data-testid={testID}
    >
      {highlighted ? (
        <div
          className={cn(
            "pointer-events-none absolute z-[5] bg-primary",
            horizontal ? "inset-y-0 -left-px w-[3px]" : "inset-x-0 -top-px h-[3px]",
          )}
          data-testid={testID ? `${testID}-highlight` : undefined}
        />
      ) : null}
      {finePointer ? (
        <div
          role="separator"
          aria-orientation={horizontal ? "vertical" : "horizontal"}
          className={cn(
            "absolute z-10 touch-none",
            horizontal ? "inset-y-0 w-2.5 cursor-col-resize" : "inset-x-0 h-2.5 cursor-row-resize",
            HIT_AREA_OFFSET[direction][alignEnd ? "end" : "center"],
          )}
          onPointerDown={handlePointerDown}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        />
      ) : (
        <div
          role="separator"
          aria-orientation={horizontal ? "vertical" : "horizontal"}
          className={cn(
            "absolute z-10 flex touch-none items-center justify-center",
            horizontal
              ? "top-1/2 h-[88px] w-6 -translate-y-1/2"
              : "left-1/2 h-6 w-[88px] -translate-x-1/2",
            TOUCH_AREA_OFFSET[direction][alignEnd ? "end" : "center"],
          )}
          onPointerDown={handlePointerDown}
        >
          <div
            className={cn(
              "pointer-events-none rounded-[2px] bg-foreground",
              horizontal ? "h-9 w-1" : "h-1 w-9",
              highlighted ? "opacity-30" : "opacity-[0.12]",
            )}
          />
        </div>
      )}
    </div>
  );
}
