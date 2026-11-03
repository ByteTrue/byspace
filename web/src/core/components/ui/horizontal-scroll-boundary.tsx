// Port of packages/app/src/components/ui/horizontal-scroll-boundary.tsx: 24px fades at the
// ends of a horizontal scroller, each shown only while there is more content that way.
import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { cn } from "cn";

const EDGE_EPSILON = 1;

export function useHorizontalScrollBoundary() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const left = node.scrollLeft > EDGE_EPSILON;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - EDGE_EPSILON;
    setEdges((current) =>
      current.left === left && current.right === right ? current : { left, right },
    );
  }, []);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);
  const onScroll = useCallback((_event: UIEvent<HTMLDivElement>) => measure(), [measure]);
  return { ref, onScroll, showLeft: edges.left, showRight: edges.right, measure };
}

export function HorizontalScrollBoundaryShades({
  visible,
  backdrop,
  showLeft,
  showRight,
  testIDPrefix = "horizontal-scroll-boundary",
}: {
  visible: boolean;
  backdrop: "surface" | "sidebar";
  showLeft: boolean;
  showRight: boolean;
  testIDPrefix?: string;
}) {
  if (!visible) return null;
  const from = backdrop === "sidebar" ? "from-sidebar" : "from-background";
  const shade = "pointer-events-none absolute top-0 bottom-px w-6 transition-opacity";
  return (
    <>
      <div
        data-testid={`${testIDPrefix}-left`}
        className={cn(
          shade,
          "left-0 bg-linear-to-r to-transparent",
          from,
          showLeft ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        data-testid={`${testIDPrefix}-right`}
        className={cn(
          shade,
          "right-0 bg-linear-to-l to-transparent",
          from,
          showRight ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  );
}
