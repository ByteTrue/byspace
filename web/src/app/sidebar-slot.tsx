import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface SidebarSlot {
  element: HTMLElement | null;
  setClaimed: (claimed: boolean) => void;
}

const SidebarSlotContext = createContext<SidebarSlot | null>(null);

export const SidebarSlotProvider = SidebarSlotContext.Provider;

/**
 * Renders a route's own navigation in the app's desktop sidebar (app-chrome), so every desktop
 * route shares one sidebar: its width, resize rail and frame. Settings uses it; a route that
 * renders this gets the sidebar open, one that doesn't gets the workspace list.
 */
export function SidebarSlotPortal({ children }: { children: ReactNode }) {
  const slot = useContext(SidebarSlotContext);
  const setClaimed = slot?.setClaimed;
  useEffect(() => {
    if (!setClaimed) return;
    setClaimed(true);
    return () => setClaimed(false);
  }, [setClaimed]);
  return slot?.element ? createPortal(children, slot.element) : null;
}
