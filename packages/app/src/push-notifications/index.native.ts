import { revokeSubscription, startSubscription } from "./internal/subscriptions";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./internal/types";
import type { WebPushState } from "./internal/web-subscription";

export type { WebPushState };

export function startPushNotifications(input: StartPushNotificationsInput): () => void {
  return startSubscription(input);
}

export function revokePushNotifications(input: RevokePushNotificationsInput): Promise<void> {
  return revokeSubscription(input).catch((error) => {
    console.warn("[PushNotifications] Failed to remove local push subscription", error);
  });
}

export {
  enableWebPush,
  getWebPushState,
  isWebPushSupported,
} from "./internal/web-push-unsupported";
