import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller module reaches the toast host and the host runtime, which pull in modules that
// ship untranspiled Flow sources. Same stubs the other app tests use, so importing the pure
// guard does not require a renderer.
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { beginSidebarPinToggle, endSidebarPinToggle } from "./use-sidebar-workspace-pin";

// The controller's cross-instance concurrency contract lives in the module-scope pending set.
// The hook itself only wraps it, so the guard is exercised directly: two controller instances
// (menu click + keyboard shortcut) must not fire a second toggle while one is in flight, and a
// settled mutation (success or failure) must release the key or the workspace is unpinnable for
// the rest of the session.
describe("sidebar pin toggle in-flight guard", () => {
  // The pending set is module scope on purpose, so a test that leaves a key claimed would
  // poison the next one. Release the keys under test before each case.
  beforeEach(() => {
    endSidebarPinToggle("srv:ws-a");
    endSidebarPinToggle("srv:ws-b");
  });

  it("claims a workspace key once; a concurrent second toggle is a no-op", () => {
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(true);
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(false);
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(false);
  });

  it("allows a different workspace while the first is still pending", () => {
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(true);
    expect(beginSidebarPinToggle("srv:ws-b")).toBe(true);
  });

  it("releases the key on settle so a retry can fire (success path)", () => {
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(true);
    endSidebarPinToggle("srv:ws-a");
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(true);
  });

  it("releases the key on settle even when the toggle failed", () => {
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(true);
    endSidebarPinToggle("srv:ws-a");
    // The onSettled handler runs for rejected mutations too; without it the retry would be
    // swallowed and the workspace would stay unpinnable for the session.
    expect(beginSidebarPinToggle("srv:ws-a")).toBe(true);
  });
});
