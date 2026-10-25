import type pino from "pino";

import { PushService, type PushPayload } from "./push-service.js";
import { PushTokenStore } from "./token-store.js";
import { loadOrCreateVapidKeys } from "./vapid-keys.js";
import { parseWebPushSubscription, WebPushService } from "./web-push-service.js";

export type { PushPayload };

/**
 * Browser subscriptions and Expo tokens share one store; the token's own shape
 * decides which transport carries it.
 */
export function partitionPushTokens(tokens: readonly string[]): {
  webPushTokens: string[];
  expoTokens: string[];
} {
  const webPushTokens: string[] = [];
  const expoTokens: string[] = [];
  for (const token of tokens) {
    if (parseWebPushSubscription(token)) {
      webPushTokens.push(token);
    } else {
      expoTokens.push(token);
    }
  }
  return { webPushTokens, expoTokens };
}

const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;

export interface PushNotifications {
  renew(token: string): void;
  revoke(token: string): void;
  send(payload: PushPayload): Promise<void>;
  /** VAPID application server public key, or null when Web Push is unavailable. */
  webPushPublicKey(): string | null;
}

export type PushNotificationSender = Pick<PushNotifications, "send">;

export function createPushNotifications(options: {
  logger: pino.Logger;
  filePath: string;
  vapidFilePath?: string;
  now?: () => number;
  deliver?: (tokens: string[], payload: PushPayload) => Promise<void>;
}): PushNotifications {
  const now = options.now ?? Date.now;
  const store = new PushTokenStore(options.logger, options.filePath, now, PUSH_TOKEN_LEASE_MS);
  const revoke = (token: string) => store.revokeToken(token);
  const expoService = new PushService(options.logger, revoke);
  const vapidKeys = options.vapidFilePath
    ? loadOrCreateVapidKeys({ logger: options.logger, filePath: options.vapidFilePath })
    : null;
  const webPushService = vapidKeys ? new WebPushService(options.logger, vapidKeys, revoke) : null;

  const deliver =
    options.deliver ??
    (async (tokens: string[], payload: PushPayload) => {
      const { webPushTokens, expoTokens } = partitionPushTokens(tokens);

      await Promise.all([
        expoTokens.length > 0 ? expoService.sendPush(expoTokens, payload) : Promise.resolve(),
        webPushTokens.length > 0 && webPushService
          ? webPushService.sendPush(webPushTokens, payload)
          : Promise.resolve(),
      ]);
    });

  return {
    renew(token) {
      store.renewToken(token);
    },
    revoke(token) {
      store.revokeToken(token);
    },
    async send(payload) {
      const tokens = store.getActiveTokens();
      options.logger.info({ tokenCount: tokens.length }, "Sending push notification");
      if (tokens.length === 0) return;
      await deliver(tokens, payload);
    },
    webPushPublicKey() {
      return vapidKeys?.publicKey ?? null;
    },
  };
}
