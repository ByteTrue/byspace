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
  /** The two elements shadcn sizes with `--sidebar-width`: the gap and the fixed container. */
  sized: HTMLElement[];
  frame: number;
}

// While dragging, the width goes straight on the two sized elements. Setting shadcn's
// `--sidebar-width` instead restyles every element that inherits it each frame: on the provider
// that is the whole app, on these two the whole sidebar.
function applyWidth(drag: RailDrag): void {
  drag.frame = 0;
  for (const element of drag.sized) element.style.width = `${drag.width}px`;
}

/**
 * shadcn's SidebarRail on the desktop sidebar's edge. A click collapses or expands the sidebar, as
 * shipped; a drag on the open sidebar resizes it. The drag writes shadcn's `--sidebar-width` on the
 * DOM once per frame, so React does not re-render per pointer move, and stores the width on release.
 */
export function SidebarResizeRail({
  width,
  viewportWidth,
  collapsible = true,
}: {
  width: number;
  viewportWidth: number;
  /** False for a route's own navigation (Settings): the rail resizes it, a click does nothing. */
  collapsible?: boolean;
}) {
  const { t } = useTranslation();
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const expanded = useSidebar().state === "expanded" || !collapsible;
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
      const sized = wrapper
        ? [
            ...wrapper.querySelectorAll<HTMLElement>(
              '[data-slot="sidebar-gap"], [data-slot="sidebar-container"]',
            ),
          ]
        : [];
      dragRef.current = {
        startX: event.clientX,
        startWidth: width,
        width,
        moved: false,
        wrapper,
        sized,
        frame: 0,
      };
    },
    [expanded, width],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // react-resizable-panels hit-tests every pointermove on the document unless it was handled,
      // reading layout each time: the drag's main cost before this.
      event.preventDefault();
      const delta = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      drag.width = resolveDesktopSidebarWidth({
        requestedWidth: drag.startWidth + delta,
        viewportWidth,
      });
      if (!drag.frame) drag.frame = requestAnimationFrame(() => applyWidth(drag));
    },
    [viewportWidth],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    drag.wrapper?.removeAttribute("data-resizing");
    if (!drag.moved) return;
    applyWidth(drag);
    setSidebarWidth(drag.width);
    // The provider carries the stored width from the render this release flushes; hand back to it.
    requestAnimationFrame(() => {
      for (const element of drag.sized) element.style.removeProperty("width");
    });
  }, [setSidebarWidth]);

  const handlePointerCancel = useCallback(() => {
    handlePointerUp();
    dragRef.current = null;
  }, [handlePointerUp]);

  const handleClick = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved || !collapsible) return;
    toggleDesktopAgentList();
  }, [collapsible, toggleDesktopAgentList]);
  const label = collapsible ? t("shell.menu.toggleSidebar") : t("shell.menu.resizeSidebar");

  return (
    <SidebarRail
      data-testid="left-sidebar-rail"
      aria-label={label}
      title={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
    />
  );
}
