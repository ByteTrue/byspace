import { useCallback, useRef, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import { usePanelStore } from "@/stores/panel-store";
import { SidebarRail, useSidebar } from "~/components/ui/sidebar";

// A press that moves less than this is a click, which collapses the sidebar as shadcn's rail does.
const DRAG_THRESHOLD_PX = 3;

interface RailDrag {
  startX: number;
  startWidth: number;
  width: number;
  moved: boolean;
  wrapper: HTMLElement | null;
}

/**
 * shadcn's SidebarRail on the desktop sidebar's edge. A click collapses or expands the sidebar, as
 * shipped; a drag on the open sidebar resizes it. The drag writes `--sidebar-width` on the provider
 * (shadcn's width variable) directly, so the app does not re-render per pointer move, and stores
 * the width on release.
 */
export function SidebarResizeRail({
  width,
  viewportWidth,
}: {
  width: number;
  viewportWidth: number;
}) {
  const { t } = useTranslation();
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const expanded = useSidebar().state === "expanded";
  const dragRef = useRef<RailDrag | null>(null);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      // A closed sidebar's rail is the strip at the window edge; it only reopens the sidebar.
      if (event.button !== 0 || !expanded) return;
      // No text selection while dragging; the click still fires.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const wrapper = event.currentTarget.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');
      // Turns off shadcn's width transition while the pointer drives the width (app-chrome).
      wrapper?.setAttribute("data-resizing", "");
      dragRef.current = { startX: event.clientX, startWidth: width, width, moved: false, wrapper };
    },
    [expanded, width],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      drag.width = resolveDesktopSidebarWidth({
        requestedWidth: drag.startWidth + delta,
        viewportWidth,
      });
      drag.wrapper?.style.setProperty("--sidebar-width", `${drag.width}px`);
    },
    [viewportWidth],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.wrapper?.removeAttribute("data-resizing");
    if (drag.moved) setSidebarWidth(drag.width);
  }, [setSidebarWidth]);

  const handlePointerCancel = useCallback(() => {
    handlePointerUp();
    dragRef.current = null;
  }, [handlePointerUp]);

  const handleClick = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return;
    toggleDesktopAgentList();
  }, [toggleDesktopAgentList]);

  return (
    <SidebarRail
      data-testid="left-sidebar-rail"
      aria-label={t("shell.menu.toggleSidebar")}
      title={t("shell.menu.toggleSidebar")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
    />
  );
}
