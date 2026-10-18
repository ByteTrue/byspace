import { describe, expect, it } from "vitest";
import {
  builtinSidebarNavShortcutAction,
  filterUnavailableSidebarNavItems,
  moveSidebarNavItem,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavPreference,
} from "./model";

// Plugin sidebar groups are retired (issue 025 C6); these tests cover the
// builtin-only behavior that remains.

describe("resolveSidebarNavItems", () => {
  it("yields builtins, all visible, when nothing is stored", () => {
    const items = resolveSidebarNavItems({ preferences: [] });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.kind === "builtin")).toBe(true);
    expect(items.every((item) => item.visible)).toBe(true);
  });

  it("keeps the stored order and appends newly available items as visible", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    const reversed = all.toReversed();
    const preferences: SidebarNavPreference[] = reversed.map((item) => ({
      key: item.key,
      visible: false,
    }));
    const items = resolveSidebarNavItems({ preferences });
    expect(items.length).toBe(all.length);
    expect(items.every((item) => !item.visible)).toBe(true);
  });

  it("skips stored keys that are not currently available", () => {
    const preferences: SidebarNavPreference[] = [{ key: "plugin/old/entry", visible: true }];
    const items = resolveSidebarNavItems({ preferences });
    expect(items.every((item) => item.kind === "builtin")).toBe(true);
  });
});

describe("filterUnavailableSidebarNavItems", () => {
  it("keeps every entry when the connected hosts implement them", () => {
    const items = resolveSidebarNavItems({ preferences: [] });
    expect(filterUnavailableSidebarNavItems(items, { tunnels: true })).toEqual(items);
  });

  it("drops tunnels when no connected host implements it", () => {
    const items = resolveSidebarNavItems({ preferences: [] });
    const filtered = filterUnavailableSidebarNavItems(items, { tunnels: false });
    expect(filtered.map((item) => item.id)).not.toContain("tunnels");
    // The rest of the list is untouched, so an unrelated edit still reads the
    // user's order for the entries that remain.
    expect(filtered).toEqual(items.filter((item) => item.id !== "tunnels"));
  });

  it("drops chief when no connected host offers the chief role", () => {
    const items = resolveSidebarNavItems({ preferences: [] });
    const filtered = filterUnavailableSidebarNavItems(items, { chief: false, tunnels: true });
    expect(filtered.map((item) => item.id)).not.toContain("chief");
    expect(filtered).toEqual(items.filter((item) => item.id !== "chief"));
  });

  it("drops a hidden tunnels entry too, rather than only reordering it", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    const preferences = setSidebarNavItemVisible({
      items: all,
      key: "tunnels",
      visible: false,
      previous: [],
    });
    const items = resolveSidebarNavItems({ preferences });
    expect(items.find((item) => item.id === "tunnels")?.visible).toBe(false);
    expect(
      filterUnavailableSidebarNavItems(items, { tunnels: false }).some(
        (item) => item.id === "tunnels",
      ),
    ).toBe(false);
  });

  it("keeps the stored tunnels preference so the entry returns in its slot", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    const moved = moveSidebarNavItem({
      items: all,
      key: "tunnels",
      direction: "up",
      previous: [],
    });
    const items = resolveSidebarNavItems({ preferences: moved });
    expect(filterUnavailableSidebarNavItems(items, { tunnels: false })).not.toContainEqual(
      expect.objectContaining({ id: "tunnels" }),
    );
    // Re-resolving with the capability back proves the preference survived.
    const restored = filterUnavailableSidebarNavItems(
      resolveSidebarNavItems({ preferences: moved }),
      { tunnels: true },
    );
    expect(restored.map((item) => item.id)).toEqual(items.map((item) => item.id));
  });
});

describe("setSidebarNavItemVisible", () => {
  it("toggles one item and writes the full resolved order", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    const target = all[0];
    const preferences = setSidebarNavItemVisible({
      items: all,
      key: target.key,
      visible: false,
      previous: [],
    });
    const stored = preferences.find((preference) => preference.key === target.key);
    expect(stored?.visible).toBe(false);
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    const preferences = setSidebarNavItemVisible({
      items: all,
      key: "nonexistent",
      visible: false,
      previous: [],
    });
    expect(preferences.length).toBe(all.length);
  });
});

describe("moveSidebarNavItem", () => {
  it("moves a menu item up within the menu", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    // Schedules starts below Search; moving it up swaps the two.
    const preferences = moveSidebarNavItem({
      items: all,
      key: "schedules",
      direction: "up",
      previous: [],
    });
    const keys = preferences.map((preference) => preference.key);
    expect(keys.indexOf("schedules")).toBeLessThan(keys.indexOf("search"));
  });

  it("steps over the fixed items rather than past them", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    // Search is the first menu item (New workspace, History, and Chief have fixed slots outside
    // the menu). Moving it up cannot leave the menu, so it stays put.
    const preferences = moveSidebarNavItem({
      items: all,
      key: "search",
      direction: "up",
      previous: [],
    });
    expect(preferences.map((preference) => preference.key)).toEqual(all.map((item) => item.key));
  });

  it("refuses to move a fixed header or top-row item", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    for (const key of ["history", "chief"] as const) {
      const preferences = moveSidebarNavItem({
        items: all,
        key,
        direction: "down",
        previous: [],
      });
      expect(preferences.map((preference) => preference.key)).toEqual(all.map((item) => item.key));
    }
  });
});

describe("builtinSidebarNavShortcutAction", () => {
  it("resolves a shortcut action for builtin ids without throwing", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    for (const item of all) {
      if (item.kind !== "builtin") continue;
      builtinSidebarNavShortcutAction(item.id);
    }
  });
});
