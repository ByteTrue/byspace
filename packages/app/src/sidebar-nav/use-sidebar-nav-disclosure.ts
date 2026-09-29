import { useCallback, useState } from "react";

/**
 * Disclosure state for the BySpace app menu.
 *
 * Both shells render the same thing — a BySpace button that reveals the top-level nav entries
 * beneath itself — so they share this state shape rather than each writing their own toggle and
 * collapse callbacks that could drift.
 */
export interface SidebarNavDisclosure {
  expanded: boolean;
  toggle: () => void;
  collapse: () => void;
}

export function useSidebarNavDisclosure(): SidebarNavDisclosure {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const collapse = useCallback(() => setExpanded(false), []);

  return { expanded, toggle, collapse };
}
