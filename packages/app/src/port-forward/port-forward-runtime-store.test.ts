import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  portForwardKey,
  resetPortForwardRuntimeStore,
  stopTrackedPortForward,
  trackPortForward,
  usePortForwardRuntimeStore,
} from "./port-forward-runtime-store";
import type { OpenedPortForward, PortForwardClient } from "./port-forward-service";

const forward: OpenedPortForward = {
  forwardId: "forward-1",
  sourceServerId: "source",
  targetServerId: "target",
  localHost: "127.0.0.1",
  localPort: 45173,
  targetPort: 5173,
  createdAt: 123,
};

function createClient(
  options: {
    closeRejects?: boolean;
    initialStatus?: "connected" | "disconnected" | "disposed";
  } = {},
) {
  let listener: ((state: never) => void) | null = null;
  const unsubscribe = vi.fn();
  const closeRemoteTcpForward = vi.fn(async () => {
    if (options.closeRejects) throw new Error("already closed");
    return { requestId: "close", closed: true };
  });
  const client = {
    subscribeConnectionStatus: vi.fn((next: (state: never) => void) => {
      listener = next;
      if (options.initialStatus) next({ status: options.initialStatus } as never);
      return unsubscribe;
    }),
    closeRemoteTcpForward,
  } as unknown as PortForwardClient;
  return {
    client,
    closeRemoteTcpForward,
    unsubscribe,
    emit(status: "connected" | "disconnected" | "disposed") {
      listener?.({ status } as never);
    },
  };
}

describe("port forward runtime store", () => {
  beforeEach(() => {
    resetPortForwardRuntimeStore();
  });

  afterEach(() => {
    resetPortForwardRuntimeStore();
  });

  it("removes a forward immediately when its source session disconnects", () => {
    const fake = createClient();
    trackPortForward(forward, fake.client);

    expect(usePortForwardRuntimeStore.getState().forwards[0]?.status).toBe("active");
    fake.emit("disconnected");

    expect(usePortForwardRuntimeStore.getState().forwards).toEqual([]);
    expect(fake.closeRemoteTcpForward).not.toHaveBeenCalled();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  it.each(["disconnected", "disposed"] as const)(
    "unsubscribes when registration synchronously reports %s",
    (initialStatus) => {
      const fake = createClient({ initialStatus });

      trackPortForward(forward, fake.client);

      expect(usePortForwardRuntimeStore.getState().forwards).toEqual([]);
      expect(fake.unsubscribe).toHaveBeenCalledOnce();
    },
  );

  it("removes a forward after an explicit stop succeeds", async () => {
    const fake = createClient();
    trackPortForward(forward, fake.client);

    await stopTrackedPortForward(portForwardKey(forward));

    expect(fake.closeRemoteTcpForward).toHaveBeenCalledWith("forward-1");
    expect(usePortForwardRuntimeStore.getState().forwards).toEqual([]);
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not restore a row when the source disconnects during stop", async () => {
    const fake = createClient();
    let resolveClose!: (value: { requestId: string; closed: boolean }) => void;
    const pendingClose = new Promise<{ requestId: string; closed: boolean }>((resolve) => {
      resolveClose = resolve;
    });
    fake.closeRemoteTcpForward.mockReturnValue(pendingClose);
    trackPortForward(forward, fake.client);

    const stop = stopTrackedPortForward(portForwardKey(forward));
    expect(usePortForwardRuntimeStore.getState().forwards[0]?.status).toBe("stopping");

    fake.emit("disconnected");
    expect(usePortForwardRuntimeStore.getState().forwards).toEqual([]);

    resolveClose({ requestId: "close", closed: true });
    await stop;
    expect(usePortForwardRuntimeStore.getState().forwards).toEqual([]);
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  it("keeps a forward manageable when an explicit stop fails", async () => {
    const fake = createClient({ closeRejects: true });
    trackPortForward(forward, fake.client);

    await expect(stopTrackedPortForward(portForwardKey(forward))).rejects.toThrow("already closed");

    expect(usePortForwardRuntimeStore.getState().forwards).toEqual([
      { ...forward, status: "active" },
    ]);
    expect(fake.unsubscribe).not.toHaveBeenCalled();
  });
});
