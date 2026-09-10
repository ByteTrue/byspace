import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./types";

const SERVICE_WORKER_URL = "/sw.js";

/*
 * One service worker registration per host.
 *
 * A registration holds at most one push subscription, and each daemon signs with
 * its own VAPID key — the push service rejects a sender whose key differs from the
 * one given at subscribe time. Sharing a single registration across hosts would
 * make them fight, each resubscribing over the other. Distinct scopes give each
 * host its own PushManager. The scope path never has to resolve to a page; push
 * and notifications are origin-scoped, not path-scoped.
 */
function registrationScope(serverId: string): string {
  return `/push/${encodeURIComponent(serverId)}/`;
}

export type WebPushState =
  /** The browser has no Push API, or this is a native build. */
  | "unsupported"
  /** The daemon does not advertise Web Push (too old, or key generation failed). */
  | "unavailable"
  /** The user or the platform blocked notifications; only settings can undo this. */
  | "denied"
  /** Permission has never been asked. Asking requires a user gesture. */
  | "prompt"
  | "enabled";

export function isWebPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function readVapidPublicKey(client: DaemonClient | null): string | null {
  const info = client?.getLastServerInfoMessage();
  if (info?.features?.webPush !== true) {
    return null;
  }
  const key = info.webPushPublicKey;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

/**
 * iOS only exposes Web Push to Home Screen web apps, and every browser requires a
 * user gesture for the permission prompt, so subscribing is split in two: this
 * reports what is possible right now, and `enableWebPush` is what a button calls.
 */
export async function getWebPushState(
  client: DaemonClient | null,
  serverId: string,
): Promise<WebPushState> {
  if (!isWebPushSupported()) {
    return "unsupported";
  }
  if (!readVapidPublicKey(client)) {
    return "unavailable";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  if (Notification.permission !== "granted") {
    return "prompt";
  }

  const registration = await navigator.serviceWorker.getRegistration(registrationScope(serverId));
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "enabled" : "prompt";
}

export async function enableWebPush(input: {
  client: DaemonClient;
  serverId: string;
}): Promise<WebPushState> {
  if (!isWebPushSupported()) {
    return "unsupported";
  }
  const publicKey = readVapidPublicKey(input.client);
  if (!publicKey) {
    return "unavailable";
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return permission === "denied" ? "denied" : "prompt";
    }
  } else if (Notification.permission === "denied") {
    return "denied";
  }

  const registered = await subscribeAndRegister(input.client, input.serverId, publicKey);
  // A failed subscribe is retryable, so stay in "prompt" and keep the button.
  // "unavailable" is reserved for a daemon that does not offer Web Push at all.
  return registered ? "enabled" : "prompt";
}

/**
 * Reconciles the browser's subscription with the daemon on every connect. The
 * browser owns the subscription, so there is nothing to cache locally — but the
 * daemon leases tokens, so re-registering on reconnect is what keeps it alive.
 */
export function startWebSubscription(input: StartPushNotificationsInput): () => void {
  if (!isWebPushSupported()) {
    return () => undefined;
  }

  let stopped = false;
  const syncIfPermitted = () => {
    if (stopped || Notification.permission !== "granted") {
      return;
    }
    const publicKey = readVapidPublicKey(input.client);
    if (!publicKey) {
      return;
    }
    void subscribeAndRegister(input.client, input.serverId, publicKey).catch((error) => {
      console.warn("[WebPush] Failed to register subscription", error);
    });
  };

  if (input.client.isConnected) {
    syncIfPermitted();
  }
  const unsubscribe = input.client.subscribeConnectionStatus((state) => {
    if (state.status === "connected") {
      syncIfPermitted();
    }
  });

  return () => {
    stopped = true;
    unsubscribe();
  };
}

export async function revokeWebSubscription(input: RevokePushNotificationsInput): Promise<void> {
  if (!isWebPushSupported()) {
    return;
  }
  const registration = await navigator.serviceWorker.getRegistration(
    registrationScope(input.serverId),
  );
  if (!registration) {
    return;
  }
  const subscription = await registration.pushManager.getSubscription();

  await unregisterToken(input.client, subscription ? serializeSubscription(subscription) : null);
  await subscription?.unsubscribe().catch(() => undefined);
  await registration.unregister().catch(() => undefined);
}

async function subscribeAndRegister(
  client: DaemonClient,
  serverId: string,
  publicKey: string,
): Promise<boolean> {
  const applicationServerKey = decodeBase64Url(publicKey);
  if (!applicationServerKey) {
    return false;
  }

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: registrationScope(serverId),
  });

  let existing = await registration.pushManager.getSubscription();
  // A daemon that regenerated its VAPID pair can no longer encrypt for the old
  // subscription, so a mismatch has to be resubscribed. If the unsubscribe fails
  // we stop instead of falling back: registering the stale subscription would
  // look like success and then never deliver.
  if (existing && hasDifferentApplicationServerKey(existing, applicationServerKey)) {
    const staleToken = serializeSubscription(existing);
    const removed = await existing.unsubscribe().catch(() => false);
    if (!removed) {
      console.warn("[WebPush] Could not replace a subscription with a stale application key");
      return false;
    }
    // Without this the daemon keeps pushing to a dead endpoint until the 48h
    // token lease expires or a send comes back 404/410.
    await unregisterToken(client, staleToken);
    existing = null;
  }

  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));

  const token = serializeSubscription(subscription);
  if (!token) {
    return false;
  }
  if (client.isConnected) {
    client.registerPushToken(token);
  }
  return true;
}

async function unregisterToken(client: DaemonClient | null, token: string | null): Promise<void> {
  if (
    !token ||
    !client?.isConnected ||
    client.getLastServerInfoMessage()?.features?.pushTokenRevocation !== true
  ) {
    return;
  }
  try {
    await client.unregisterPushToken(token);
  } catch (error) {
    console.warn("[WebPush] Failed to revoke subscription", error);
  }
}

/**
 * Only true when the keys can be compared and differ. A browser that does not
 * expose `options.applicationServerKey` must not be resubscribed on every
 * connect, so an unreadable key counts as a match.
 */
function hasDifferentApplicationServerKey(
  subscription: PushSubscription,
  expected: Uint8Array<ArrayBuffer>,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) {
    return false;
  }
  const bytes = new Uint8Array(current);
  if (bytes.length !== expected.length) {
    return true;
  }
  return bytes.some((value, index) => value !== expected[index]);
}

function serializeSubscription(subscription: PushSubscription): string | null {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return null;
  }
  return JSON.stringify({ endpoint, keys: { p256dh, auth } });
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
