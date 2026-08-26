import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";

const storage = vi.hoisted(() => ({
  getItem: vi.fn<() => Promise<string | null>>(),
  removeItem: vi.fn<() => Promise<void>>(),
  setItem: vi.fn<() => Promise<void>>(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-notifications", () => ({
  PermissionStatus: { GRANTED: "granted" },
  AndroidImportance: { DEFAULT: 3 },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { revokeSubscription } from "./subscriptions";

describe("revokeSubscription", () => {
  beforeEach(() => {
    storage.getItem.mockReset();
    storage.removeItem.mockReset();
    storage.setItem.mockReset();
    storage.removeItem.mockResolvedValue();
  });

  it("unregisters a stored token before removing it locally", async () => {
    const events: string[] = [];
    storage.getItem.mockResolvedValue("ExponentPushToken[token]");
    storage.removeItem.mockImplementation(async () => {
      events.push("remove");
    });
    const client = {
      isConnected: true,
      getLastServerInfoMessage: () => ({ features: { pushTokenRevocation: true } }),
      unregisterPushToken: async (token: string) => {
        events.push(`unregister:${token}`);
      },
    } as unknown as DaemonClient;

    await revokeSubscription({ client, serverId: "server" });

    expect(events).toEqual(["unregister:ExponentPushToken[token]", "remove"]);
    expect(storage.removeItem).toHaveBeenCalledWith("@byspace:expo-push-token:server");
  });

  it("still removes the local token when daemon revocation fails", async () => {
    storage.getItem.mockResolvedValue("ExponentPushToken[token]");
    const error = new Error("offline");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = {
      isConnected: true,
      getLastServerInfoMessage: () => ({ features: { pushTokenRevocation: true } }),
      unregisterPushToken: vi.fn().mockRejectedValue(error),
    } as unknown as DaemonClient;

    await revokeSubscription({ client, serverId: "server" });

    expect(warn).toHaveBeenCalledWith("[PushNotifications] Failed to revoke push token", error);
    expect(storage.removeItem).toHaveBeenCalledWith("@byspace:expo-push-token:server");
    warn.mockRestore();
  });
});
