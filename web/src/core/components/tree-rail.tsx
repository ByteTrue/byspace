// Port of archive/expo-app:packages/app/src/components/tree-rail.tsx: content on the left, a tree on the right
// whose left edge drags to resize it. The width rules are the shared tree-rail-layout; the drag
// previews locally and commits on release, like the Expo gesture.
import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  acceptTreeRailContainerMeasurement,
  resolveVisibleTreeRailWidth,
} from "@/components/tree-rail-layout";
import { usePanelStore } from "@/stores/panel-store";

export interface TreeRailProps {
  /** Exactly two children, in order: content, then tree. */
  children: ReactNode;
  testID?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  minimumWidth?: number;
}

/** Content-left/tree-right master-detail geometry with one app-wide tree width. */
export function TreeRail({ children, testID, width, onWidthChange, minimumWidth }: TreeRailProps) {
  const [content, tree] = Children.toArray(children);
  const sharedWidth = usePanelStore((state) => state.treeRailWidth);
  const setSharedWidth = usePanelStore((state) => state.setTreeRailWidth);
  const requestedWidth = width ?? sharedWidth;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => window.innerWidth);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const visibleWidth =
    draftWidth ?? resolveVisibleTreeRailWidth(requestedWidth, containerWidth, minimumWidth);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () =>
      setContainerWidth((current) =>
        acceptTreeRailContainerMeasurement(current, element.getBoundingClientRect().width),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const commitWidth = onWidthChange ?? setSharedWidth;
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: visibleWidth, width: visibleWidth };
    },
    [visibleWidth],
  );
  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // The handle is on the tree's left edge: dragging left widens the tree.
      drag.width = resolveVisibleTreeRailWidth(
        drag.startWidth - (event.clientX - drag.startX),
        containerWidth,
        minimumWidth,
      );
      setDraftWidth(drag.width);
    },
    [containerWidth, minimumWidth],
  );
  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    commitWidth(drag.width);
    setDraftWidth(null);
  }, [commitWidth]);
  useEffect(() => {
    if (draftWidth === null) return;
    const cursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.cursor = cursor;
    };
  }, [draftWidth]);
  const railStyle = useMemo(() => ({ width: visibleWidth }), [visibleWidth]);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1" data-testid={testID}>
      <div
        className="flex min-w-0 flex-1 flex-col"
        data-testid={testID ? `${testID}-content` : undefined}
      >
        {content}
      </div>
      <div
        className="relative flex shrink-0 flex-col border-l"
        style={railStyle}
        data-testid={testID ? `${testID}-tree` : undefined}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          data-testid={testID ? `${testID}-resize-handle` : "tree-rail-resize-handle"}
          className="absolute inset-y-0 -left-[5px] z-10 w-2.5 cursor-col-resize after:absolute after:inset-y-0 after:left-[5px] after:w-px after:bg-transparent after:transition-colors after:duration-0 hover:after:bg-foreground/25 hover:after:delay-100"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        {tree}
      </div>
    </div>
  );
}
