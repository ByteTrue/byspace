/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigate, hostsState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  hostsState: { current: [] as unknown[] },
}));

vi.mock("expo-router", () => ({
  router: { navigate },
}));

vi.mock("@/runtime/host-runtime", () => ({
  // Minimal HostProfile shape: the hook only reads hosts.length today, but the mock must
  // not silently satisfy a future field access with a shape production never produces.
  useHosts: () => hostsState.current,
}));

import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useGlobalNewWorkspaceAction } from "./use-global-new-workspace-action";

const hostProfile = { serverId: "host-a" };

describe("useGlobalNewWorkspaceAction", () => {
  beforeEach(() => {
    navigate.mockClear();
    registered.length = 0;
    hostsState.current = [hostProfile];
  });

  it("routes without a host so the screen resolver owns the initial host", () => {
    renderHook(() => useGlobalNewWorkspaceAction());
    const handler = capturedHandler();
    expect(handler).toBeDefined();
    expect(handler!.handle({ id: "workspace.new" } as KeyboardActionDefinition)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/new");
  });

  it("stays disabled while no host is connected", () => {
    hostsState.current = [];
    renderHook(() => useGlobalNewWorkspaceAction());
    const handler = capturedHandler();
    expect(handler).toBeDefined();
    expect(handler!.isActive!()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

function capturedHandler() {
  return registered.find((entry) => entry.handlerId === "workspace-new-global") ?? null;
}

const registered: Array<{
  handlerId: string;
  actions: readonly string[];
  enabled: boolean;
  isActive?: () => boolean;
  handle: (action: KeyboardActionDefinition) => boolean;
}> = [];

vi.mock("@/keyboard/keyboard-action-dispatcher-context", () => ({
  useKeyboardActionDispatcher: () => ({
    registerHandler: (entry: (typeof registered)[number]) => {
      registered.push(entry);
      return () => {
        const index = registered.indexOf(entry);
        if (index >= 0) registered.splice(index, 1);
      };
    },
  }),
}));
