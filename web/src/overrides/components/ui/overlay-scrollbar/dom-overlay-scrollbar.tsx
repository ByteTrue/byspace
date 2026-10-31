// Override of packages/app/src/components/ui/overlay-scrollbar (the DOM half): a thin scrollbar
// thumb over a scroll container, draggable, faint until hovered or dragged.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  computeOverlayScrollbarGeometry,
  scrollOffsetFromThumbDrag,
} from "@/components/ui/overlay-scrollbar/geometry";
import { WEB_SCROLLBAR_RESTING_OPACITY, WEB_SCROLLBAR_SIZE_PX } from "@/styles/web-scrollbar";
import { cn } from "cn";

const THUMB_WIDTH = WEB_SCROLLBAR_SIZE_PX - 4;
const GRAB_WIDTH = 12;
const TRACK_STYLE = { width: WEB_SCROLLBAR_SIZE_PX };

interface OverlayScrollbarMetrics {
  offset: number;
  viewportSize: number;
  contentSize: number;
}

export function DomOverlayScrollbar({
  scrollContainerRef,
  onUserScrollUp,
}: {
  scrollContainerRef: RefObject<HTMLElement | null>;
  onUserScrollUp: () => void;
}) {
  const [metrics, setMetrics] = useState<OverlayScrollbarMetrics>({
    offset: 0,
    viewportSize: 0,
    contentSize: 0,
  });
  const syncMetrics = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    setMetrics({
      offset: Math.max(0, scrollContainer.scrollTop),
      viewportSize: Math.max(0, scrollContainer.clientHeight),
      contentSize: Math.max(0, scrollContainer.scrollHeight),
    });
  }, [scrollContainerRef]);
  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    syncMetrics();
    scrollContainer.addEventListener("scroll", syncMetrics, { passive: true });
    const observer = new ResizeObserver(syncMetrics);
    observer.observe(scrollContainer);
    const content = scrollContainer.firstElementChild;
    if (content) observer.observe(content);
    return () => {
      scrollContainer.removeEventListener("scroll", syncMetrics);
      observer.disconnect();
    };
  }, [scrollContainerRef, syncMetrics]);
  const scrollToOffset = useCallback(
    (offset: number) => {
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) scrollContainer.scrollTop = offset;
    },
    [scrollContainerRef],
  );

  const geometry = useMemo(() => computeOverlayScrollbarGeometry(metrics), [metrics]);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const dragStartClientYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const lastRequestedOffsetRef = useRef(0);
  const reportedUpwardIntentRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const startDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragStartClientYRef.current = event.clientY;
      dragStartOffsetRef.current = metrics.offset;
      lastRequestedOffsetRef.current = metrics.offset;
      reportedUpwardIntentRef.current = false;
      setIsDragging(true);
    },
    [metrics.offset],
  );
  useEffect(() => {
    if (!isDragging) return;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const current = geometryRef.current;
      const nextOffset = scrollOffsetFromThumbDrag({
        startOffset: dragStartOffsetRef.current,
        dragDelta: event.clientY - dragStartClientYRef.current,
        maxScrollOffset: current.maxScrollOffset,
        maxThumbOffset: current.maxThumbOffset,
      });
      if (nextOffset < lastRequestedOffsetRef.current && !reportedUpwardIntentRef.current) {
        reportedUpwardIntentRef.current = true;
        onUserScrollUp();
      }
      lastRequestedOffsetRef.current = nextOffset;
      scrollToOffset(nextOffset);
    };
    const stopDragging = () => setIsDragging(false);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [isDragging, onUserScrollUp, scrollToOffset]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const active = isHovered || isDragging;
  const grabStyle = useMemo(
    () => ({
      right: -(GRAB_WIDTH - WEB_SCROLLBAR_SIZE_PX) / 2,
      width: GRAB_WIDTH,
      height: geometry.thumbSize,
      transform: `translateY(${geometry.thumbOffset}px)`,
      cursor: isDragging ? "grabbing" : "grab",
    }),
    [geometry.thumbOffset, geometry.thumbSize, isDragging],
  );
  const thumbStyle = useMemo(
    () => ({ width: THUMB_WIDTH, opacity: active ? 1 : WEB_SCROLLBAR_RESTING_OPACITY }),
    [active],
  );
  if (!geometry.isVisible) return null;
  return (
    <div
      className="pointer-events-none absolute top-0 right-0 bottom-0 z-10"
      style={TRACK_STYLE}
      data-testid="workspace-overlay-scrollbar"
    >
      <div
        className="pointer-events-auto absolute top-0 flex touch-none items-center justify-center select-none"
        style={grabStyle}
        onPointerDown={startDrag}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        data-testid="workspace-overlay-scrollbar-grab"
      >
        <div
          className={cn("h-full rounded-full", active ? "bg-muted-foreground" : "bg-ring")}
          style={thumbStyle}
          data-testid="workspace-overlay-scrollbar-thumb"
        />
      </div>
    </div>
  );
}
