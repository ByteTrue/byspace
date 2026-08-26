/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClientActivity } from "./use-client-activity.native";

const mocks = vi.hoisted(() => ({
  currentState: "active",
  listener: null as ((state: string) => void) | null,
  remove: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.currentState;
    },
    addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
      mocks.listener = listener;
      return { remove: mocks.remove };
    }),
  },
}));

describe("useClientActivity native", () => {
  beforeEach(() => {
    mocks.currentState = "active";
    mocks.listener = null;
    mocks.remove.mockReset();
  });

  afterEach(cleanup);

  it("tracks mobile visibility without browser document globals", () => {
    const sendHeartbeat = vi.fn();
    const unsubscribe = vi.fn();
    const onAppResumed = vi.fn();
    const onWindowFocused = vi.fn();
    const client = {
      isConnected: true,
      sendHeartbeat,
      subscribeConnectionStatus: (listener: (state: { status: string }) => void) => {
        listener({ status: "connected" });
        return unsubscribe;
      },
    } as unknown as DaemonClient;

    const { unmount } = renderHook(() =>
      useClientActivity({
        client,
        focusedAgentId: null,
        focusedTerminalId: null,
        onUserActivity: vi.fn(),
        onAppResumed,
        onWindowFocused,
      }),
    );

    expect(sendHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ deviceType: "mobile", appVisible: true }),
    );

    act(() => mocks.listener?.("background"));
    act(() => mocks.listener?.("active"));

    expect(onAppResumed).toHaveBeenCalledOnce();
    expect(onWindowFocused).toHaveBeenCalledOnce();
    expect(sendHeartbeat).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceType: "mobile", appVisible: true }),
    );

    unmount();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
