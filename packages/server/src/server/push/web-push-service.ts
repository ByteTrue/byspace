import type pino from "pino";
import webpush, { WebPushError, type PushSubscription } from "web-push";

import type { PushPayload } from "./push-service.js";
import type { VapidKeys } from "./vapid-keys.js";

/**
 * Contact URL advertised to push services in the VAPID `sub` claim. Push service
 * operators use it to reach whoever is sending; a self-hosted daemon has no
 * per-user contact, so the project itself is the honest answer.
 */
const VAPID_SUBJECT = "https://github.com/ByteTrue/byspace";

const NOTIFICATION_TTL_SECONDS = 12 * 60 * 60;

/**
 * A Web Push subscription serialized into the opaque `register_push_token` string.
 *
 * Keeping the subscription inside the existing token field is what lets one token
 * store carry both Expo tokens and browser subscriptions without a protocol change.
 */
export function parseWebPushSubscription(token: string): PushSubscription | null {
  const trimmed = token.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { endpoint, keys } = parsed as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    return null;
  }
  if (typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") {
    return null;
  }
  if (keys.p256dh.length === 0 || keys.auth.length === 0) {
    return null;
  }

  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/**
 * Sends browser notifications straight from the daemon to each subscription's push
 * service. The payload is encrypted per RFC 8291 with keys the browser generated,
 * so the push service relays ciphertext it cannot read.
 */
export class WebPushService {
  private readonly logger: pino.Logger;
  private readonly keys: VapidKeys;
  private readonly revokeToken: (token: string) => void;

  constructor(logger: pino.Logger, keys: VapidKeys, revokeToken: (token: string) => void) {
    this.logger = logger.child({ component: "web-push-service" });
    this.keys = keys;
    this.revokeToken = revokeToken;
  }

  async sendPush(tokens: string[], payload: PushPayload): Promise<void> {
    if (tokens.length === 0) {
      return;
    }

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    });

    await Promise.all(tokens.map((token) => this.sendOne(token, body)));
  }

  private async sendOne(token: string, body: string): Promise<void> {
    const subscription = parseWebPushSubscription(token);
    if (!subscription) {
      return;
    }

    try {
      await webpush.sendNotification(subscription, body, {
        TTL: NOTIFICATION_TTL_SECONDS,
        vapidDetails: {
          subject: VAPID_SUBJECT,
          publicKey: this.keys.publicKey,
          privateKey: this.keys.privateKey,
        },
      });
    } catch (error) {
      this.handleSendError(token, subscription.endpoint, error);
    }
  }

  private handleSendError(token: string, endpoint: string, error: unknown): void {
    if (error instanceof WebPushError) {
      // Only 404/410 revoke. A 403 (VAPID key does not match the one used at
      // subscribe time) is also permanent, but the client resubscribes on a key
      // mismatch, so retrying until the 48h lease expires is the safer default
      // than dropping a token over a push service that answers 403 for its own
      // reasons.
      if (error.statusCode === 404 || error.statusCode === 410) {
        this.logger.info({ endpoint }, "Web Push subscription expired; revoking");
        this.revokeToken(token);
        return;
      }
      this.logger.error(
        { endpoint, statusCode: error.statusCode, body: error.body },
        "Web Push delivery failed",
      );
      return;
    }
    this.logger.error({ err: error, endpoint }, "Web Push delivery failed");
  }
}
