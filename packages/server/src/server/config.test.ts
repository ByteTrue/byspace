import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveBundledWebUiDistDir, resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig, type PersistedConfig } from "./persisted-config.js";

const roots: string[] = [];

describe("server config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("records when the daemon is managed by BySpace Desktop", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-desktop-managed-"));
    roots.push(paseoHome);

    const desktopConfig = loadConfig(paseoHome, {
      env: { PASEO_DESKTOP_MANAGED: "1" },
    });
    const standaloneConfig = loadConfig(paseoHome, { env: {} });

    expect(desktopConfig.desktopManaged).toBe(true);
    expect(standaloneConfig.desktopManaged).toBe(false);
  });

  test("loads the provider catalog refresh timeout", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-provider-timeout-"));
    roots.push(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({ agents: { catalogRefreshTimeoutMs: 180_000 } }),
    );

    const config = loadConfig(paseoHome, { env: {} });

    expect(config.providerCatalogRefreshTimeoutMs).toBe(180_000);
  });

  test("resolves reload state from the supplied validated snapshot", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-snapshot-"));
    roots.push(paseoHome);
    const snapshot = loadPersistedConfig(paseoHome);
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        ...snapshot,
        daemon: { ...snapshot.daemon, browserTools: { enabled: true } },
      }),
    );

    expect(resolveConfigFromPersisted(paseoHome, snapshot, { env: {} }).browserToolsEnabled).toBe(
      false,
    );
    expect(loadConfig(paseoHome, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("records mutable and startup launch overrides by persisted leaf", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-config-overrides-"));
    roots.push(paseoHome);
    const config = loadConfig(paseoHome, {
      env: {
        BYSPACE_LISTEN: "127.0.0.1:7000",
        PASEO_PASSWORD: "secret",
        PASEO_RELAY_ENDPOINT: "relay.example.test:443",
        PASEO_TRUSTED_PROXIES: "true",
        PASEO_WEB_UI_ENABLED: "true",
        PASEO_LOG_FILE_PATH: "custom.log",
        PASEO_VOICE_LLM_PROVIDER: "codex",
      },
      cli: { relayUseTls: false },
    });

    expect(config.configReload?.overrideControlledPaths).toEqual([
      "daemon.auth.password",
      "daemon.listen",
      "daemon.relay.endpoint",
      "daemon.relay.useTls",
      "daemon.trustedProxies",
      "features.voiceMode.llm.provider",
      "features.webUi.enabled",
      "log.file.path",
    ]);
    expect(config.listen).toBe("127.0.0.1:7000");
    expect(config.trustedProxies).toBe(true);
    expect(config.log?.file?.path).toBe("custom.log");
    expect(config.voiceLlmProvider).toBe("codex");
  });

  test("uses the BySpace port and ignores the legacy Paseo listen override", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "byspace-config-defaults-"));
    roots.push(paseoHome);

    const config = loadConfig(paseoHome, {
      env: { PASEO_LISTEN: "127.0.0.1:6767" },
    });

    expect(config.listen).toBe("127.0.0.1:6777");
  });

  test("prefers public BYSPACE environment variables over legacy aliases", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "byspace-config-env-"));
    roots.push(paseoHome);

    const config = loadConfig(paseoHome, {
      env: {
        BYSPACE_APP_BASE_URL: "https://app.byspace.example",
        BYSPACE_PASSWORD: "byspace-password",
        BYSPACE_RELAY_ENDPOINT: "relay.byspace.example:443",
        PASEO_APP_BASE_URL: "https://legacy.example",
        PASEO_PASSWORD: "legacy-password",
        PASEO_RELAY_ENDPOINT: "legacy.example:443",
      },
    });

    expect(config.appBaseUrl).toBe("https://app.byspace.example");
    expect(config.relayEndpoint).toBe("relay.byspace.example:443");
    expect(config.auth).toBeDefined();
  });

  test.each([
    ["0.7.0", "https://app.byspace.cc.cd", "relay.byspace.cc.cd:443"],
    ["0.7.0-beta.2", "https://app-beta.byspace.cc.cd", "relay.byspace.cc.cd:443"],
  ])(
    "uses the %s hosted release endpoints",
    (releaseVersion, expectedAppBaseUrl, expectedRelayEndpoint) => {
      const persisted = {
        version: 1,
        daemon: { cors: { allowedOrigins: ["http://localhost"] } },
      } satisfies PersistedConfig;

      const config = resolveConfigFromPersisted("/tmp/byspace", persisted, {
        env: {},
        releaseVersion,
      });

      expect(config.appBaseUrl).toBe(expectedAppBaseUrl);
      expect(config.relayEndpoint).toBe(expectedRelayEndpoint);
      expect(config.relayPublicEndpoint).toBe(expectedRelayEndpoint);
      expect(config.relayUseTls).toBe(true);
      expect(config.relayPublicUseTls).toBe(true);
      expect(config.corsAllowedOrigins).toEqual(["http://localhost"]);
    },
  );

  test.each([
    ["0.7.0", "https://app-beta.byspace.cc.cd", "relay.byspace.cc.cd:443"],
    ["0.7.0-beta.2", "https://app.byspace.cc.cd", "relay.byspace.cc.cd:443"],
  ])(
    "migrates persisted official App defaults to the %s release channel",
    (releaseVersion, persistedAppBaseUrl, persistedRelayEndpoint) => {
      const persisted = {
        version: 1,
        app: { baseUrl: persistedAppBaseUrl },
        daemon: {
          cors: { allowedOrigins: [persistedAppBaseUrl] },
          relay: {
            endpoint: persistedRelayEndpoint,
            publicEndpoint: persistedRelayEndpoint,
          },
        },
      } satisfies PersistedConfig;

      const config = resolveConfigFromPersisted("/tmp/byspace", persisted, {
        env: {},
        releaseVersion,
      });
      const expectedAppBaseUrl = releaseVersion.includes("-")
        ? "https://app-beta.byspace.cc.cd"
        : "https://app.byspace.cc.cd";
      const expectedRelayEndpoint = "relay.byspace.cc.cd:443";

      expect(config.appBaseUrl).toBe(expectedAppBaseUrl);
      expect(config.corsAllowedOrigins).toEqual([expectedAppBaseUrl]);
      expect(config.relayEndpoint).toBe(expectedRelayEndpoint);
      expect(config.relayPublicEndpoint).toBe(expectedRelayEndpoint);
    },
  );

  test("preserves custom persisted endpoints across release channels", () => {
    const persisted = {
      version: 1,
      app: { baseUrl: "https://self-hosted.example.com" },
      daemon: {
        cors: { allowedOrigins: ["https://self-hosted.example.com"] },
        relay: {
          endpoint: "relay.internal.example.com:8080",
          publicEndpoint: "relay.example.com:443",
          useTls: false,
          publicUseTls: true,
        },
      },
    } satisfies PersistedConfig;

    const config = resolveConfigFromPersisted("/tmp/byspace", persisted, {
      env: {},
      releaseVersion: "0.7.0-beta.2",
    });

    expect(config.appBaseUrl).toBe("https://self-hosted.example.com");
    expect(config.corsAllowedOrigins).toEqual(["https://self-hosted.example.com"]);
    expect(config.relayEndpoint).toBe("relay.internal.example.com:8080");
    expect(config.relayPublicEndpoint).toBe("relay.example.com:443");
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });

  test.each([
    {
      name: "local speech providers",
      providers: { dictation: "local", voiceStt: "local", voiceTts: "local" },
      expected: [
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
    {
      name: "OpenAI speech providers",
      providers: { dictation: "openai", voiceStt: "openai", voiceTts: "openai" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
        "features.voiceMode.tts.voice",
      ],
    },
    {
      name: "mixed local and OpenAI speech providers",
      providers: { dictation: "local", voiceStt: "openai", voiceTts: "local" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
  ])("classifies speech overrides for $name", ({ providers, expected }) => {
    const config = resolveConfigFromPersisted(
      "/tmp/paseo-speech-override-classification",
      {
        version: 1,
        features: {
          dictation: { enabled: true, stt: { provider: providers.dictation } },
          voiceMode: {
            enabled: true,
            stt: { provider: providers.voiceStt },
            tts: { provider: providers.voiceTts },
          },
        },
      },
      {
        env: {
          OPENAI_API_KEY: "test-api-key",
          PASEO_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          PASEO_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          PASEO_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
          STT_CONFIDENCE_THRESHOLD: "0.5",
          STT_MODEL: "whisper-1",
          TTS_MODEL: "tts-1",
          TTS_VOICE: "alloy",
        },
      },
    );

    expect(config.configReload?.overrideControlledPaths).toEqual(expected);
  });

  test("resolves bundled web UI path from source-tree modules", () => {
    const root = path.parse(process.cwd()).root;
    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(root, "repo", "packages", "server", "src", "server", "config.ts"),
        ),
      }),
    ).toBe(path.join(root, "repo", "packages", "server", "dist", "server", "web-ui"));
  });

  test("resolves bundled web UI path from globally installed compiled modules", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-config-compiled-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "dist", "server", "web-ui"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "server", "server", "config.js")),
      }),
    ).toBe(path.join(packageRoot, "dist", "server", "web-ui"));
  });

  test("resolves packaged desktop web UI path from resources app-dist", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-config-packaged-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "app-dist"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(
            packageRoot,
            "app.asar",
            "node_modules",
            "@getpaseo",
            "server",
            "dist",
            "server",
            "server",
            "config.js",
          ),
        ),
        resourcesPath: packageRoot,
      }),
    ).toBe(path.join(packageRoot, "app-dist"));
  });
});
