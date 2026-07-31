import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { extractGrokTokenFromAuth, GrokQuotaProvider } from "./grok.js";

describe("GrokQuotaProvider", () => {
  afterEach(() => {
    delete process.env.GROK_API_KEY;
  });

  test("reads current nested and legacy auth shapes", () => {
    expect(extractGrokTokenFromAuth({ access_token: "legacy" })).toBe("legacy");
    expect(
      extractGrokTokenFromAuth({
        "https://auth.x.ai::user": { key: "current", refresh_token: "refresh" },
      }),
    ).toBe("current");
  });

  test("reads current config.used billing shape", async () => {
    process.env.GROK_API_KEY = "token";
    const provider = new GrokQuotaProvider({
      logger: pino({ level: "silent" }),
      fetch: async () =>
        new Response(
          JSON.stringify({ config: { monthlyLimit: { val: 100 }, used: { val: 25 } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(provider.fetchUsage()).resolves.toMatchObject({
      status: "available",
      balances: [{ used: 25, remaining: 75, limit: 100 }],
    });
  });
});
