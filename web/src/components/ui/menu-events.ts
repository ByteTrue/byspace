import type { MouseEvent } from "react";

/**
 * BySpace: a right click inside an open menu does nothing, as in packages/app. The menu is a portal,
 * and React bubbles its events up the component tree rather than the DOM, so a right click on an
 * item reached the context-menu trigger around the menu's own trigger (a file list's background
 * menu around a row) and opened that menu on top.
 */
export function stopContextMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}
