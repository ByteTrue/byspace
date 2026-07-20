import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  BETA_HOSTED_RELEASE,
  STABLE_HOSTED_RELEASE,
} from "@bytetrue/byspace-protocol/release-channel";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createBySpaceHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "byspace-config-relay-"));
  roots.push(root);
  const byspaceHome = path.join(root, ".byspace");
  await mkdir(byspaceHome, { recursive: true });
  await writeFile(path.join(byspaceHome, "config.json"), JSON.stringify(config, null, 2));
  return byspaceHome;
}

describe("daemon relay config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("loads relay TLS from env, persisted config, and hosted relay fallback", async () => {
    const persistedHome = await createBySpaceHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: true,
        },
      },
    });
    expect(loadConfig(persistedHome, { env: {} }).relayUseTls).toBe(true);

    const envHome = await createBySpaceHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: false,
        },
      },
    });
    expect(loadConfig(envHome, { env: { BYSPACE_RELAY_USE_TLS: "true" } }).relayUseTls).toBe(true);

    const hostedHome = await createBySpaceHome({
      version: 1,
      daemon: { relay: {} },
    });
    expect(loadConfig(hostedHome, { env: {} }).relayUseTls).toBe(true);
  });

  test("maps managed stable config to beta infrastructure", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: STABLE_HOSTED_RELEASE.relayEndpoint,
          publicEndpoint: BETA_HOSTED_RELEASE.relayEndpoint,
        },
        cors: {
          allowedOrigins: [
            STABLE_HOSTED_RELEASE.appBaseUrl,
            BETA_HOSTED_RELEASE.appBaseUrl,
            "https://custom.example.com",
          ],
        },
      },
      app: { baseUrl: STABLE_HOSTED_RELEASE.appBaseUrl },
    });

    const config = loadConfig(home, { env: {}, releaseVersion: "0.2.0-beta.2" });

    expect(config.daemonVersion).toBe("0.2.0-beta.2");
    expect(config.relayEndpoint).toBe(BETA_HOSTED_RELEASE.relayEndpoint);
    expect(config.relayPublicEndpoint).toBe(BETA_HOSTED_RELEASE.relayEndpoint);
    expect(config.relayUseTls).toBe(true);
    expect(config.relayPublicUseTls).toBe(true);
    expect(config.appBaseUrl).toBe(BETA_HOSTED_RELEASE.appBaseUrl);
    expect(config.corsAllowedOrigins).toEqual([
      BETA_HOSTED_RELEASE.appBaseUrl,
      "https://custom.example.com",
    ]);
  });

  test("maps managed beta config to stable infrastructure", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: { relay: { endpoint: BETA_HOSTED_RELEASE.relayEndpoint } },
      app: { baseUrl: BETA_HOSTED_RELEASE.appBaseUrl },
    });

    const config = loadConfig(home, { env: {}, releaseVersion: "0.2.0" });

    expect(config.relayEndpoint).toBe(STABLE_HOSTED_RELEASE.relayEndpoint);
    expect(config.appBaseUrl).toBe(STABLE_HOSTED_RELEASE.appBaseUrl);
  });

  test("preserves custom values and adds explicit environment overrides", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "persisted-relay.example.com:443",
          publicEndpoint: "persisted-public.example.com:443",
        },
        cors: { allowedOrigins: ["https://persisted.example.com"] },
      },
      app: { baseUrl: "https://persisted-app.example.com" },
    });

    const config = loadConfig(home, {
      releaseVersion: "0.2.0-beta.2",
      env: {
        BYSPACE_RELAY_ENDPOINT: "env-relay.example.com:443",
        BYSPACE_RELAY_PUBLIC_ENDPOINT: "env-public.example.com:443",
        BYSPACE_APP_BASE_URL: "https://env-app.example.com",
        BYSPACE_CORS_ORIGINS:
          "https://persisted.example.com, https://env.example.com,https://env.example.com",
      },
    });

    expect(config.relayEndpoint).toBe("env-relay.example.com:443");
    expect(config.relayPublicEndpoint).toBe("env-public.example.com:443");
    expect(config.appBaseUrl).toBe("https://env-app.example.com");
    expect(config.corsAllowedOrigins).toEqual([
      "https://persisted.example.com",
      "https://env.example.com",
    ]);
  });

  test("relayPublicUseTls falls back to relayUseTls when unset", async () => {
    const home = await createBySpaceHome({ version: 1, daemon: { relay: {} } });
    // Default: both true (hosted relay)
    expect(loadConfig(home, { env: {} }).relayPublicUseTls).toBe(true);
  });

  test("BYSPACE_RELAY_PUBLIC_USE_TLS overrides relayUseTls for public side", async () => {
    const home = await createBySpaceHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, {
      env: { BYSPACE_RELAY_USE_TLS: "false", BYSPACE_RELAY_PUBLIC_USE_TLS: "true" },
    });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });

  test("relayPublicUseTls falls back to relayUseTls when only BYSPACE_RELAY_USE_TLS is set", async () => {
    const home = await createBySpaceHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, { env: { BYSPACE_RELAY_USE_TLS: "false" } });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(false);
  });

  test("persisted publicUseTls overrides relayUseTls fallback", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: { relay: { useTls: false, publicUseTls: true } },
    });
    const config = loadConfig(home, { env: {} });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });
});

describe("daemon service proxy config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("loads public base URL from env before persisted config", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: {
        serviceProxy: {
          publicBaseUrl: "https://persisted.example.com",
        },
      },
    });

    const config = loadConfig(home, {
      env: { BYSPACE_SERVICE_PROXY_PUBLIC_BASE_URL: "https://env.example.com/" },
    });

    expect(config.serviceProxy).toEqual({
      publicBaseUrl: "https://env.example.com",
      standaloneListen: null,
    });
  });

  test("does not synthesize a standalone service listener from enabled true", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: { serviceProxy: { enabled: true } },
    });

    expect(loadConfig(home, { env: {} }).serviceProxy).toEqual({
      publicBaseUrl: null,
      standaloneListen: null,
    });
  });

  test("enabled false suppresses optional service proxy layers only", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: {
        serviceProxy: {
          enabled: false,
          listen: "127.0.0.1:9999",
          publicBaseUrl: "https://persisted.example.com",
        },
      },
    });

    expect(loadConfig(home, { env: {} }).serviceProxy).toEqual({
      publicBaseUrl: null,
      standaloneListen: null,
    });
  });

  test("rejects invalid BYSPACE_SERVICE_PROXY_PUBLIC_BASE_URL values", async () => {
    const home = await createBySpaceHome({ version: 1 });

    expect(() =>
      loadConfig(home, {
        env: { BYSPACE_SERVICE_PROXY_PUBLIC_BASE_URL: "not-a-url" },
      }),
    ).toThrow("Invalid BYSPACE_SERVICE_PROXY_PUBLIC_BASE_URL: not-a-url");
  });
});

describe("daemon trusted proxy config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("trusts loopback proxies by default", async () => {
    const home = await createBySpaceHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).trustedProxies).toEqual(["loopback"]);
  });

  test("loads trusted proxies from persisted config", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: {
        trustedProxies: ["loopback", "10.0.0.0/8"],
      },
    });

    expect(loadConfig(home, { env: {} }).trustedProxies).toEqual(["loopback", "10.0.0.0/8"]);
  });

  test("BYSPACE_TRUSTED_PROXIES overrides persisted config", async () => {
    const home = await createBySpaceHome({
      version: 1,
      daemon: {
        trustedProxies: ["loopback"],
      },
    });

    const config = loadConfig(home, {
      env: { BYSPACE_TRUSTED_PROXIES: "loopback,172.16.0.0/12" },
    });

    expect(config.trustedProxies).toEqual(["loopback", "172.16.0.0/12"]);
  });

  test("BYSPACE_TRUSTED_PROXIES supports explicit trust-all and trust-none modes", async () => {
    const trustAllHome = await createBySpaceHome({ version: 1 });
    expect(
      loadConfig(trustAllHome, { env: { BYSPACE_TRUSTED_PROXIES: "true" } }).trustedProxies,
    ).toBe(true);

    const trustNoneHome = await createBySpaceHome({ version: 1 });
    expect(
      loadConfig(trustNoneHome, { env: { BYSPACE_TRUSTED_PROXIES: "false" } }).trustedProxies,
    ).toEqual([]);
  });
});

describe("daemon worktree root config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("resolves relative worktrees.root against BYSPACE_HOME", async () => {
    const home = await createBySpaceHome({
      version: 1,
      worktrees: { root: "custom-worktrees" },
    });

    expect(loadConfig(home, { env: {} }).worktreesRoot).toBe(path.join(home, "custom-worktrees"));
  });

  test("keeps absolute worktrees.root absolute", async () => {
    const home = await createBySpaceHome({
      version: 1,
      worktrees: { root: path.join(os.tmpdir(), "byspace-custom-worktrees") },
    });

    expect(loadConfig(home, { env: {} }).worktreesRoot).toBe(
      path.join(os.tmpdir(), "byspace-custom-worktrees"),
    );
  });
});
