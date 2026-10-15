import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configureDevDaemonConfig,
  configureDevBySpaceHome,
  resolveDevDaemonEndpoint,
} from "./dev-home.mjs";

test("resolveDevDaemonEndpoint maps loopback listen addresses to localhost", () => {
  assert.equal(resolveDevDaemonEndpoint("127.0.0.1:6778"), "localhost:6778");
  assert.equal(resolveDevDaemonEndpoint("0.0.0.0:6778"), "localhost:6778");
  assert.equal(resolveDevDaemonEndpoint("192.168.1.10:6778"), "192.168.1.10:6778");
});

test("configureDevDaemonConfig writes valid daemon config with wildcard cors", () => {
  const tempHome = mkdtempSync(join(tmpdir(), "dev-daemon-cfg-"));
  try {
    configureDevDaemonConfig(tempHome, "0.0.0.0:6779");
    const written = JSON.parse(readFileSync(join(tempHome, "config.json"), "utf8"));
    assert.equal(written.version, 1);
    assert.equal(written.daemon.listen, "0.0.0.0:6779");
    assert.deepEqual(written.daemon.cors.allowedOrigins, ["*"]);
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

/**
 * Restores the env keys a `configureDevBySpaceHome` case touches, so cases cannot leak into each other.
 */
function withDevHomeEnv(overrides, run) {
  const keys = [
    "BYSPACE_HOME",
    "BYSPACE_LISTEN",
    "BYSPACE_DEV_ROOT",
    "BYSPACE_DEV_MANAGED_HOME",
    "BYSPACE_DEV_SEED_HOME",
    "BYSPACE_SERVICE_DAEMON_PORT",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      delete process.env[key];
    }
    Object.assign(process.env, overrides);
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("configureDevBySpaceHome gives a workspace service a home inside its own checkout", () => {
  const checkoutRoot = mkdtempSync(join(tmpdir(), "dev-home-service-root-"));
  const inheritedHome = mkdtempSync(join(tmpdir(), "dev-home-service-inherited-"));
  try {
    // The daemon that starts a worktree service passes its own BYSPACE_HOME down. The service
    // must not adopt it: that home can sit outside the worktree, where the pid-lock heartbeat
    // can never see the worktree disappear, so the service outlives it.
    const resolvedHome = withDevHomeEnv(
      {
        BYSPACE_HOME: inheritedHome,
        BYSPACE_DEV_ROOT: checkoutRoot,
        BYSPACE_SERVICE_DAEMON_PORT: "57001",
        BYSPACE_LISTEN: "0.0.0.0:57001",
      },
      () => configureDevBySpaceHome(),
    );

    assert.equal(resolvedHome, join(checkoutRoot, ".dev/byspace-home"));
    assert.notEqual(resolvedHome, inheritedHome);
  } finally {
    rmSync(checkoutRoot, { recursive: true, force: true });
    rmSync(inheritedHome, { recursive: true, force: true });
  }
});

test("configureDevBySpaceHome still honors an inherited home for a non-service process", () => {
  const checkoutRoot = mkdtempSync(join(tmpdir(), "dev-home-plain-root-"));
  const inheritedHome = mkdtempSync(join(tmpdir(), "dev-home-plain-inherited-"));
  try {
    const resolvedHome = withDevHomeEnv(
      {
        BYSPACE_HOME: inheritedHome,
        BYSPACE_DEV_ROOT: checkoutRoot,
        BYSPACE_LISTEN: "127.0.0.1:6778",
      },
      () => configureDevBySpaceHome(),
    );

    assert.equal(resolvedHome, inheritedHome);
  } finally {
    rmSync(checkoutRoot, { recursive: true, force: true });
    rmSync(inheritedHome, { recursive: true, force: true });
  }
});

test("configureDevBySpaceHome initializes byspace home and daemon config when managed", () => {
  const tempHome = mkdtempSync(join(tmpdir(), "dev-home-"));
  const previousHome = process.env.BYSPACE_HOME;
  const previousListen = process.env.BYSPACE_LISTEN;
  const previousManaged = process.env.BYSPACE_DEV_MANAGED_HOME;
  try {
    process.env.BYSPACE_HOME = tempHome;
    process.env.BYSPACE_LISTEN = "127.0.0.1:6778";
    process.env.BYSPACE_DEV_MANAGED_HOME = "1";
    const resolvedHome = configureDevBySpaceHome();
    assert.equal(resolvedHome, tempHome);
    const written = JSON.parse(readFileSync(join(tempHome, "config.json"), "utf8"));
    assert.equal(written.daemon.listen, "127.0.0.1:6778");
  } finally {
    if (previousHome === undefined) {
      delete process.env.BYSPACE_HOME;
    } else {
      process.env.BYSPACE_HOME = previousHome;
    }
    if (previousListen === undefined) {
      delete process.env.BYSPACE_LISTEN;
    } else {
      process.env.BYSPACE_LISTEN = previousListen;
    }
    if (previousManaged === undefined) {
      delete process.env.BYSPACE_DEV_MANAGED_HOME;
    } else {
      process.env.BYSPACE_DEV_MANAGED_HOME = previousManaged;
    }
    rmSync(tempHome, { recursive: true, force: true });
  }
});
