export const SIDEBAR_ROW_ITEMS = [
  "branch",
  "project",
  "host",
  "changeRequest",
  "services",
] as const;

export type SidebarRowItem = (typeof SIDEBAR_ROW_ITEMS)[number];
export type SidebarRowItems = Record<SidebarRowItem, boolean>;

export const DEFAULT_SIDEBAR_ROW_ITEMS: SidebarRowItems = {
  branch: false,
  project: false,
  host: true,
  changeRequest: true,
  services: true,
};

export function isChecksHiddenByLegacyRowItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).checks === false;
}

function isSidebarRowItem(value: string): value is SidebarRowItem {
  return (SIDEBAR_ROW_ITEMS as readonly string[]).includes(value);
}

export function parseSidebarRowItems(value: unknown): SidebarRowItems {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SIDEBAR_ROW_ITEMS;
  }
  const stored = value as Record<string, unknown>;
  const result = { ...DEFAULT_SIDEBAR_ROW_ITEMS };
  // COMPAT(sidebarRowItemsScripts): migrated in v0.5.0, remove after 2027-08-05.
  if (stored.scripts === false) result.services = false;
  for (const [key, entry] of Object.entries(stored)) {
    if (isSidebarRowItem(key) && typeof entry === "boolean") result[key] = entry;
  }
  return result;
}
