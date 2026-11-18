import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./internal/types";
import {
  enableWebPush,
  getWebPushState,
  isWebPushSupported,
  revokeWebSubscription,
  startWebSubscription,
  type WebPushState,
} from "./internal/web-subscription";

export type { WebPushState };

export function startPushNotifications(input: StartPushNotificationsInput): () => void {
  return startWebSubscription(input);
}

export function revokePushNotifications(input: RevokePushNotificationsInput): Promise<void> {
  return revokeWebSubscription(input).catch((error) => {
    console.warn("[WebPush] Failed to remove subscription", error);
  });
}

export { enableWebPush, getWebPushState, isWebPushSupported };
