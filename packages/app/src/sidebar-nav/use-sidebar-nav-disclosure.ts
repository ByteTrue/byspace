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

/**
 * `initialExpanded` exists for the shells' different first impressions: the pinned desktop
 * sidebar has room to introduce the destinations, while a compact overlay is opened *for* one of
 * them, so it starts collapsed and keeps the panel short.
 */
export function useSidebarNavDisclosure(initialExpanded = false): SidebarNavDisclosure {
  const [expanded, setExpanded] = useState(initialExpanded);

  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const collapse = useCallback(() => setExpanded(false), []);

  return { expanded, toggle, collapse };
}
