import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { partitionPushTokens } from "./index.js";
import { generateVapidKeys, loadOrCreateVapidKeys } from "./vapid-keys.js";
import { parseWebPushSubscription } from "./web-push-service.js";

const logger = pino({ level: "silent" });

function subscriptionToken(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    endpoint: "https://web.push.apple.com/abc123",
    keys: { p256dh: "BJx-p256dh-value", auth: "auth-value" },
    ...overrides,
  });
}

describe("parseWebPushSubscription", () => {
  it("accepts a serialized browser subscription", () => {
    const parsed = parseWebPushSubscription(subscriptionToken());
    expect(parsed).toEqual({
      endpoint: "https://web.push.apple.com/abc123",
      keys: { p256dh: "BJx-p256dh-value", auth: "auth-value" },
    });
  });

  it("rejects Expo tokens so they keep using the Expo transport", () => {
    expect(parseWebPushSubscription("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBeNull();
  });

  it("rejects malformed or insecure subscriptions", () => {
    expect(parseWebPushSubscription("{not json")).toBeNull();
    expect(
      parseWebPushSubscription(subscriptionToken({ endpoint: "http://insecure/x" })),
    ).toBeNull();
    expect(parseWebPushSubscription(JSON.stringify({ endpoint: "https://x/y" }))).toBeNull();
    expect(
      parseWebPushSubscription(
        JSON.stringify({ endpoint: "https://x/y", keys: { p256dh: "", auth: "a" } }),
      ),
    ).toBeNull();
  });
});

describe("partitionPushTokens", () => {
  it("splits browser subscriptions from Expo tokens", () => {
    const web = subscriptionToken();
    const expo = "ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]";
    expect(partitionPushTokens([expo, web])).toEqual({
      webPushTokens: [web],
      expoTokens: [expo],
    });
  });
});

describe("VAPID keys", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "byspace-vapid-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("generates a P-256 pair in the encoding the Push API expects", () => {
    const keys = generateVapidKeys();
    // Uncompressed EC point: 0x04 followed by two 32-byte coordinates.
    const publicKey = Buffer.from(keys.publicKey, "base64url");
    expect(publicKey.length).toBe(65);
    expect(publicKey[0]).toBe(0x04);
    expect(Buffer.from(keys.privateKey, "base64url").length).toBe(32);
  });

  it("generates once and reuses the stored pair", () => {
    const filePath = join(directory, "web-push-keys.json");
    const first = loadOrCreateVapidKeys({ logger, filePath });
    const second = loadOrCreateVapidKeys({ logger, filePath });
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    // Rotating the pair would invalidate every existing subscription.
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual(first);
  });

  it("regenerates when the stored file is unusable", () => {
    const filePath = join(directory, "web-push-keys.json");
    writeFileSync(filePath, '{"publicKey": 42}');
    const keys = loadOrCreateVapidKeys({ logger, filePath });
    expect(keys?.publicKey).toBeTruthy();
    expect(keys?.privateKey).toBeTruthy();
  });
});
