/** Titlebar drag region shim (Electron retired, issue 025 A3). Renders nothing. */
import type { ReactNode } from "react";

export function TitlebarDragRegion(): ReactNode {
  return null;
}

export const titlebarDragSurfaceStyle = { flex: 1 } as const;
