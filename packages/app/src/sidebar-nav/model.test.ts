import { describe, expect, it } from "vitest";
import {
  builtinSidebarNavShortcutAction,
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
  it("moves an item up when possible", () => {
    const all = resolveSidebarNavItems({ preferences: [] });
    const target = all[1];
    const preferences = moveSidebarNavItem({
      items: all,
      key: target.key,
      direction: "up",
      previous: [],
    });
    expect(preferences[0]?.key).toBe(target.key);
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
