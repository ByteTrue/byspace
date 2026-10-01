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
