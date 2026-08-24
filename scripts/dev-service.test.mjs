import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureManagedHome, createServiceConfig } from "./dev-service.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

test("builds an isolated daemon service environment from the assigned port", () => {
  const root = path.join(os.tmpdir(), "byspace-service-worktree");
  const service = createServiceConfig("daemon", {
    cwd: root,
    env: {
      BYSPACE_WORKTREE_PATH: root,
      BYSPACE_PORT: "7123",
      BYSPACE_CORS_ORIGINS: "http://localhost:8123",
    },
  });

  assert.equal(service.command, npmCommand);
  assert.deepEqual(service.args, ["run", "dev:server:watch"]);
  assert.equal(service.root, root);
  assert.equal(service.home, path.join(root, ".dev", "byspace-home"));
  assert.equal(service.listen, "0.0.0.0:7123");
  assert.equal(service.env.BYSPACE_DEV_MANAGED_HOME, "1");
  assert.equal(service.env.BYSPACE_HOME, service.home);
  assert.equal(service.env.BYSPACE_SKIP_DEV_SERVER_BUILD, "1");
  assert.equal(service.env.BYSPACE_CORS_ORIGINS, "http://localhost:8123");
});

test("builds the app service environment from the daemon peer port", () => {
  const root = path.join(os.tmpdir(), "byspace-service-worktree");
  const service = createServiceConfig("app", {
    cwd: root,
    env: {
      BYSPACE_WORKTREE_PATH: root,
      BYSPACE_PORT: "8123",
      BYSPACE_SERVICE_DAEMON_PORT: "7123",
    },
  });

  assert.equal(service.command, npmCommand);
  assert.deepEqual(service.args, [
    "run",
    "start:expo",
    "--workspace=@bytetrue/byspace-app",
    "--",
    "--port",
    "8123",
  ]);
  assert.equal(service.listen, "0.0.0.0:7123");
  assert.equal(service.env.BYSPACE_DEV_DAEMON_ENDPOINT, "localhost:7123");
  assert.equal(service.env.EXPO_PORT, "8123");
  assert.equal(service.env.EXPO_PUBLIC_LOCAL_DAEMON, "localhost:7123");
  assert.equal(service.env.APP_VARIANT, "development");
});

test("updates only the managed daemon settings in the local config", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "byspace-service-home-"));
  const configPath = path.join(root, "config.json");
  try {
    writeFileSync(
      configPath,
      JSON.stringify({ version: 1, daemon: { customSetting: true }, projects: { keep: true } }),
    );
    configureManagedHome(root, "0.0.0.0:7123");
    const config = JSON.parse(readFileSync(configPath, "utf8"));

    assert.equal(config.projects.keep, true);
    assert.equal(config.daemon.customSetting, true);
    assert.equal(config.daemon.listen, "0.0.0.0:7123");
    assert.deepEqual(config.daemon.cors.allowedOrigins, ["*"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
