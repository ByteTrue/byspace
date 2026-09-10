import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SERVICE_WORKER_NOTIFICATION_CLICK_MESSAGE } from "./internal/types";

/*
 * `public/sw.js` ships as a static file, so it is never bundled and never
 * typechecked. Loading it into a fake worker global is the only way to keep its
 * push handling honest.
 */
const source = readFileSync(join(__dirname, "../../public/sw.js"), "utf8");

interface FakeClient {
  focus: () => Promise<void>;
  postMessage: (message: unknown) => void;
}

function loadWorker(options: { clients?: FakeClient[] } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(
    (_title: string, _options: Record<string, unknown>): Promise<void> => Promise.resolve(),
  );
  const openWindow = vi.fn((_url: string): Promise<void> => Promise.resolve());
  const matchedClients = options.clients ?? [];

  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    skipWaiting: vi.fn(),
    location: { origin: "https://app.example" },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(() => Promise.resolve(matchedClients)),
      openWindow,
    },
  };

  // eslint-disable-next-line no-new-func -- loading the static worker under a fake global is the point.
  new Function("self", source)(self);

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const listener = listeners.get(type);
    if (!listener) {
      throw new Error(`no listener registered for "${type}"`);
    }
    const waits: unknown[] = [];
    listener({ ...event, waitUntil: (value: unknown) => waits.push(value) });
    await Promise.all(waits);
  };

  return { dispatch, listeners, showNotification, openWindow };
}

describe("service worker push handling", () => {
  it("registers the handlers push delivery needs", () => {
    const { listeners } = loadWorker();
    expect([...listeners.keys()].sort()).toEqual(["install", "notificationclick", "push"]);
  });

  it("shows the decrypted payload and tags it by agent so repeats collapse", async () => {
    const { dispatch, showNotification } = loadWorker();
    await dispatch("push", {
      data: {
        json: () => ({
          title: "Agent finished",
          body: "Done working.",
          data: { serverId: "s1", agentId: "a1", workspaceId: "w1" },
        }),
      },
    });

    expect(showNotification).toHaveBeenCalledWith("Agent finished", {
      body: "Done working.",
      data: { serverId: "s1", agentId: "a1", workspaceId: "w1" },
      icon: "/pwa-icon-192.png",
      tag: "agent:a1",
      renotify: true,
    });
  });

  it("tags terminal notifications separately", async () => {
    const { dispatch, showNotification } = loadWorker();
    await dispatch("push", {
      data: { json: () => ({ title: "Terminal", body: "x", data: { terminalId: "t9" } }) },
    });
    expect(showNotification.mock.calls[0]?.[1]).toMatchObject({ tag: "terminal:t9" });
  });

  it("still notifies when the payload is not the expected shape", async () => {
    const { dispatch, showNotification } = loadWorker();
    await dispatch("push", {
      data: {
        json: () => {
          throw new Error("not json");
        },
        text: () => "raw text",
      },
    });
    expect(showNotification).toHaveBeenCalledWith(
      "BySpace",
      expect.objectContaining({
        body: "raw text",
        tag: "byspace",
      }),
    );
  });

  it("hands the payload to an open window instead of building a route itself", async () => {
    const postMessage = vi.fn();
    const client = { focus: vi.fn(() => Promise.resolve()), postMessage };
    const { dispatch, openWindow } = loadWorker({ clients: [client] });

    const close = vi.fn();
    await dispatch("notificationclick", {
      notification: { close, data: { serverId: "s1", agentId: "a1" } },
    });

    expect(close).toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      type: SERVICE_WORKER_NOTIFICATION_CLICK_MESSAGE,
      data: { serverId: "s1", agentId: "a1" },
    });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens the app root when no window is open", async () => {
    const { dispatch, openWindow } = loadWorker({ clients: [] });
    await dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { serverId: "s1" } },
    });
    expect(openWindow).toHaveBeenCalledWith("/");
  });
});
