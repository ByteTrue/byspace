import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./internal/types";
import type { WebPushState } from "./internal/web-subscription";

export type { WebPushState };

export function startPushNotifications(_input: StartPushNotificationsInput): () => void {
  return () => undefined;
}

export async function revokePushNotifications(_input: RevokePushNotificationsInput): Promise<void> {
  // Push notifications are native-only.
}

export {
  enableWebPush,
  getWebPushState,
  isWebPushSupported,
} from "./internal/web-push-unsupported";
