import { useCallback, useEffect, useState } from "react";

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
 * `panelActive` is the shell's own "this sidebar is showing" flag, and it is what keeps the
 * disclosure from outliving its panel. Neither shell unmounts when it closes — both are retained
 * behind `display: none` so their scroll and list state survive — so without this a single expand
 * would still be open on every later visit, and the rows would cover the workspace list the
 * feature exists to keep visible.
 *
 * Taking the flag here rather than letting each shell reset itself encodes the rule once, and
 * gives both the same first impression: closed.
 */
export function useSidebarNavDisclosure(panelActive: boolean): SidebarNavDisclosure {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!panelActive) setExpanded(false);
  }, [panelActive]);

  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const collapse = useCallback(() => setExpanded(false), []);

  return { expanded, toggle, collapse };
}
