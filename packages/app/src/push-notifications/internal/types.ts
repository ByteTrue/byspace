import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

/**
 * Message the service worker posts to an open window when a Web Push notification
 * is clicked. Must stay in sync with `packages/app/public/sw.js`.
 */
export const SERVICE_WORKER_NOTIFICATION_CLICK_MESSAGE = "byspace:notification-click";

export interface StartPushNotificationsInput {
  client: DaemonClient;
  serverId: string;
}

export interface RevokePushNotificationsInput {
  client: DaemonClient | null;
  serverId: string;
}
