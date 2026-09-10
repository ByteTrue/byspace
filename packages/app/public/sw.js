/*
 * BySpace service worker.
 *
 * Push delivery only. There is deliberately NO fetch handler and no caching: the
 * app and the daemon already drift in version (docs/protocol-compatibility.md),
 * and a cache layer on top of that makes "which bundle is this user running?"
 * unanswerable. Offline shell caching, if it ever lands, needs its own versioning
 * and update prompt rather than being smuggled in here.
 */

const NOTIFICATION_ICON = "/pwa-icon-192.png";
// Must match SERVICE_WORKER_NOTIFICATION_CLICK_MESSAGE in
// src/push-notifications/internal/types.ts.
const CLICK_MESSAGE_TYPE = "byspace:notification-click";

// Take over immediately so a newer worker starts handling pushes without waiting
// for every tab to close. There is no `clients.claim()`: the registration scope is
// /push/<serverId>/, no page lives there, and with no fetch handler there is
// nothing to control anyway.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("push", (event) => {
  event.waitUntil(showPushNotification(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openFromNotification(event.notification.data));
});

async function showPushNotification(event) {
  const payload = readPayload(event);
  const data = payload.data ?? {};
  await self.registration.showNotification(payload.title, {
    body: payload.body,
    data,
    icon: NOTIFICATION_ICON,
    // Collapse repeats for the same agent or terminal, but still alert.
    tag: notificationTag(data),
    renotify: true,
  });
}

function readPayload(event) {
  const fallback = { title: "BySpace", body: "", data: {} };
  if (!event.data) {
    return fallback;
  }
  try {
    const parsed = event.data.json();
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    return {
      title: typeof parsed.title === "string" && parsed.title ? parsed.title : fallback.title,
      body: typeof parsed.body === "string" ? parsed.body : "",
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
    };
  } catch {
    return { ...fallback, body: event.data.text() };
  }
}

function notificationTag(data) {
  if (typeof data.agentId === "string" && data.agentId) {
    return `agent:${data.agentId}`;
  }
  if (typeof data.terminalId === "string" && data.terminalId) {
    return `terminal:${data.terminalId}`;
  }
  return "byspace";
}

/*
 * Route building lives in the app bundle (`utils/notification-routing.ts`), which a
 * static worker cannot import. So an open window is handed the raw data and does
 * its own navigation; a cold start only opens the app root. Deep-linking from a
 * cold start would mean duplicating the workspace-id encoding here.
 */
async function openFromNotification(data) {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clientList) {
    if ("focus" in client) {
      await client.focus();
      // Client.postMessage() is not Window.postMessage(): its second argument is a
      // transfer list, not a target origin. Passing an origin string would throw.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      client.postMessage({ type: CLICK_MESSAGE_TYPE, data: data ?? {} });
      return;
    }
  }

  if (self.clients.openWindow) {
    await self.clients.openWindow("/");
  }
}
