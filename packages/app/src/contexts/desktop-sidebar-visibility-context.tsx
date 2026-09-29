import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the pinned desktop sidebar currently occupies the window's left edge.
 *
 * The sidebar's own top row and a screen's content header both place the same toggle at the
 * window's top-left corner (`menu-button`); exactly one of them may render it. Both hosts
 * read this one value — the sidebar renders the toggle while it is visible, a content header
 * only while it is not — so the toggle can neither double up nor disappear.
 */
const DesktopSidebarVisibleContext = createContext(false);

export function DesktopSidebarVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <DesktopSidebarVisibleContext.Provider value={visible}>
      {children}
    </DesktopSidebarVisibleContext.Provider>
  );
}

/** `false` outside the app shell, where a content header is the only host for the toggle. */
export function useDesktopSidebarVisible(): boolean {
  return useContext(DesktopSidebarVisibleContext);
}
