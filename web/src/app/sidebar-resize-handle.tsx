import { useCallback, useRef, type PointerEvent } from "react";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import { usePanelStore } from "@/stores/panel-store";

/** Drag the sidebar's right edge to resize it; the width is clamped and stored on release. */
export function SidebarResizeHandle({
  width,
  viewportWidth,
  onPreview,
}: {
  width: number;
  viewportWidth: number;
  onPreview: (width: number | null) => void;
}) {
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: width, width };
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.width = resolveDesktopSidebarWidth({
        requestedWidth: drag.startWidth + event.clientX - drag.startX,
        viewportWidth,
      });
      onPreview(drag.width);
    },
    [onPreview, viewportWidth],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    setSidebarWidth(drag.width);
    onPreview(null);
  }, [onPreview, setSidebarWidth]);

  return (
    <div
      data-testid="left-sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      className="absolute inset-y-0 -right-[5px] z-20 w-2.5 cursor-col-resize after:absolute after:inset-y-0 after:left-[5px] after:w-px after:bg-transparent after:transition-colors after:duration-0 hover:after:bg-foreground/25 hover:after:delay-100"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
