import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveBundledWebUiDistDir, resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig } from "./persisted-config.js";

const roots: string[] = [];

describe("server config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("resolves reload state from the supplied validated snapshot", async () => {
    const byspaceHome = await mkdtemp(path.join(os.tmpdir(), "byspace-config-snapshot-"));
    roots.push(byspaceHome);
    const snapshot = loadPersistedConfig(byspaceHome);
    await writeFile(
      path.join(byspaceHome, "config.json"),
      JSON.stringify({
        ...snapshot,
        daemon: { ...snapshot.daemon, browserTools: { enabled: true } },
      }),
    );

    expect(resolveConfigFromPersisted(byspaceHome, snapshot, { env: {} }).browserToolsEnabled).toBe(
      false,
    );
    expect(loadConfig(byspaceHome, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("records mutable and startup launch overrides by persisted leaf", async () => {
    const byspaceHome = await mkdtemp(path.join(os.tmpdir(), "byspace-config-overrides-"));
    roots.push(byspaceHome);
    const config = loadConfig(byspaceHome, {
      env: {
        BYSPACE_LISTEN: "127.0.0.1:7000",
        BYSPACE_PASSWORD: "secret",
        BYSPACE_RELAY_ENDPOINT: "relay.example.test:443",
        BYSPACE_DATA_RELAY_ENDPOINT: "data-relay.example.test:443",
        BYSPACE_TRUSTED_PROXIES: "true",
        BYSPACE_WEB_UI_ENABLED: "true",
        BYSPACE_LOG_FILE_PATH: "custom.log",
        BYSPACE_DICTATION_ENABLED: "1",
      },
      cli: { relayUseTls: false },
    });

    expect(config.configReload?.overrideControlledPaths).toEqual([
      "daemon.auth.password",
      "daemon.dataRelay.endpoint",
      "daemon.listen",
      "daemon.relay.endpoint",
      "daemon.relay.useTls",
      "daemon.trustedProxies",
      "features.dictation.enabled",
      "features.webUi.enabled",
      "log.file.path",
    ]);
    expect(config.listen).toBe("127.0.0.1:7000");
    expect(config.trustedProxies).toBe(true);
    expect(config.log?.file?.path).toBe("custom.log");
  });

  test.each([
    {
      name: "dictation and speech overrides",
      env: {
        BYSPACE_DICTATION_ENABLED: "1",
        BYSPACE_DICTATION_LOCAL_STT_MODEL: "sensevoice-small-int8",
        BYSPACE_LOCAL_MODELS_DIR: "/tmp/models",
      },
      expected: [
        "features.dictation.enabled",
        "features.dictation.stt.model",
        "providers.local.modelsDir",
      ],
    },
  ])("classifies speech overrides for $name", ({ env, expected }) => {
    const config = resolveConfigFromPersisted(
      "/tmp/byspace-speech-override-classification",
      {
        version: 1,
        features: {
          dictation: { enabled: true, stt: { model: "sensevoice-small-int8" } },
        },
      },
      { env },
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
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-config-compiled-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "dist", "server", "web-ui"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "server", "server", "config.js")),
      }),
    ).toBe(path.join(packageRoot, "dist", "server", "web-ui"));
  });

  test("resolves packaged desktop web UI path from resources app-dist", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-config-packaged-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "app-dist"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(
            packageRoot,
            "app.asar",
            "node_modules",
            "@bytetrue",
            "byspace-server",
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
