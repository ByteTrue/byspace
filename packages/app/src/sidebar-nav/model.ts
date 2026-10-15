export const BUILTIN_SIDEBAR_NAV_IDS = [
  "new-workspace",
  "history",
  "chief",
  "search",
  "schedules",
  "tunnels",
] as const;
export type BuiltinSidebarNavId = (typeof BUILTIN_SIDEBAR_NAV_IDS)[number];

/**
 * The items the Workspaces header carries as its own icon buttons.
 *
 * They are still builtins — same labels, same routes, same visibility switches — but their place
 * is fixed by the surface that draws them rather than by the disclosure's order, so the Sidebar
 * section in Appearance offers no Move up/down for them. Folding them into the BySpace menu put
 * the two most-used destinations behind a click, which is the cost the disclosure was supposed to
 * pay for the two least-used ones.
 */
export const HEADER_SIDEBAR_NAV_IDS = ["new-workspace", "history"] as const;
export type HeaderSidebarNavId = (typeof HEADER_SIDEBAR_NAV_IDS)[number];

export function isHeaderSidebarNavId(id: BuiltinSidebarNavId): id is HeaderSidebarNavId {
  return (HEADER_SIDEBAR_NAV_IDS as readonly string[]).includes(id);
}

/** The entries that remain inside the BySpace disclosure, in the user's stored order. */
export function isDisclosureSidebarNavId(id: BuiltinSidebarNavId): boolean {
  return !isHeaderSidebarNavId(id);
}

/** Persisted shape. Array order is the display order. */
export interface SidebarNavPreference {
  key: string;
  visible: boolean;
}

export interface BuiltinSidebarNavItem {
  kind: "builtin";
  key: BuiltinSidebarNavId;
  id: BuiltinSidebarNavId;
  visible: boolean;
}

export type SidebarNavItem = BuiltinSidebarNavItem;

const BUILTIN_LABEL_KEYS: Record<BuiltinSidebarNavId, string> = {
  "new-workspace": "sidebar.actions.newWorkspace",
  history: "sidebar.sections.sessions",
  chief: "chief.title",
  search: "sidebar.sections.search",
  schedules: "sidebar.sections.schedules",
  tunnels: "sidebar.sections.tunnels",
};

export function builtinSidebarNavLabelKey(id: BuiltinSidebarNavId): string {
  return BUILTIN_LABEL_KEYS[id];
}

/**
 * Shortcut action ids (`resolveShortcutKeysForAction`) for the builtins that have one.
 * Both the sidebar row and the Appearance settings row read the badge from here so the
 * two never disagree about which shortcut belongs to which item.
 */
const BUILTIN_SHORTCUT_ACTIONS: Record<BuiltinSidebarNavId, string | null> = {
  "new-workspace": "new-workspace",
  history: null,
  chief: null,
  search: "toggle-command-center",
  schedules: null,
  tunnels: null,
};

export function builtinSidebarNavShortcutAction(id: BuiltinSidebarNavId): string | null {
  return BUILTIN_SHORTCUT_ACTIONS[id];
}

function isBuiltinSidebarNavId(key: string): key is BuiltinSidebarNavId {
  return (BUILTIN_SIDEBAR_NAV_IDS as readonly string[]).includes(key);
}

/**
 * Capability the connected daemons advertise, per builtin entry that has one.
 * A builtin absent from this map is always available.
 */
export interface SidebarNavAvailability {
  chief?: boolean;
  tunnels: boolean;
}

/**
 * Drops the entries no connected daemon can serve.
 *
 * This runs after `resolveSidebarNavItems` and before every surface that renders
 * the list, so the sidebar rows, the BySpace disclosure, and the Appearance
 * section agree. It is not persisted: `toPreferences` keeps keys it cannot place,
 * so a hidden entry returns in its stored slot once a capable host connects.
 */
export function filterUnavailableSidebarNavItems(
  items: readonly SidebarNavItem[],
  availability: SidebarNavAvailability,
): SidebarNavItem[] {
  return items.filter((item) => {
    if (item.id === "chief") return availability.chief !== false;
    if (item.id === "tunnels") return availability.tunnels;
    return true;
  });
}

export function resolveSidebarNavItems(input: {
  preferences: readonly SidebarNavPreference[];
}): SidebarNavItem[] {
  const items: SidebarNavItem[] = [];
  const placed = new Set<string>();

  for (const preference of input.preferences) {
    if (placed.has(preference.key)) continue;
    if (isBuiltinSidebarNavId(preference.key)) {
      placed.add(preference.key);
      items.push({
        kind: "builtin",
        key: preference.key,
        id: preference.key,
        visible: preference.visible,
      });
    }
  }

  for (const id of BUILTIN_SIDEBAR_NAV_IDS) {
    if (placed.has(id)) continue;
    items.push({ kind: "builtin", key: id, id, visible: true });
  }
  return items;
}

/**
 * Resolved items lead; entries for keys that are not currently available follow
 * so an unrelated edit does not erase them.
 */
function toPreferences(
  items: readonly SidebarNavItem[],
  previous: readonly SidebarNavPreference[],
): SidebarNavPreference[] {
  const remaining = items.map(({ key, visible }) => ({ key, visible }));
  const availableKeys = new Set<string>(remaining.map((preference) => preference.key));
  const preferences: SidebarNavPreference[] = [];
  const seenPrevious = new Set<string>();

  for (const preference of previous) {
    if (seenPrevious.has(preference.key)) continue;
    seenPrevious.add(preference.key);

    if (availableKeys.has(preference.key)) {
      const next = remaining.shift();
      if (next) preferences.push(next);
      continue;
    }

    preferences.push({ key: preference.key, visible: preference.visible });
  }

  preferences.push(...remaining);
  return preferences;
}

export function setSidebarNavItemVisible(input: {
  items: readonly SidebarNavItem[];
  key: string;
  visible: boolean;
  previous: readonly SidebarNavPreference[];
}): SidebarNavPreference[] {
  const items = input.items.map((item) =>
    item.key === input.key ? { ...item, visible: input.visible } : item,
  );
  return toPreferences(items, input.previous);
}

/**
 * Moves one entry within the disclosure's run.
 *
 * The header's items keep their slots, so an "up" that would have stepped past one of them lands
 * where it would have without them. That matters because the user cannot see the header items in
 * this list: an up that moved an entry past an invisible neighbour would look like nothing
 * happened.
 */
export function moveSidebarNavItem(input: {
  items: readonly SidebarNavItem[];
  key: string;
  direction: "up" | "down";
  previous: readonly SidebarNavPreference[];
}): SidebarNavPreference[] {
  const reorderable = input.items.filter((item) => !isHeaderSidebarNavId(item.id));
  const from = reorderable.findIndex((item) => item.key === input.key);
  const to = input.direction === "up" ? from - 1 : from + 1;
  const canMove = from !== -1 && to >= 0 && to < reorderable.length;
  if (!canMove) {
    return toPreferences(input.items, input.previous);
  }
  const reordered = [...reorderable];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);

  let cursor = 0;
  const items = input.items.map((item) =>
    isHeaderSidebarNavId(item.id) ? item : reordered[cursor++],
  );
  return toPreferences(items, input.previous);
}
