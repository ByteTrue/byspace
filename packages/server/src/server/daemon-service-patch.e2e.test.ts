import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDaemonTestContext } from "./test-utils/daemon-test-context.js";

/**
 * End-to-end wiring for the service-install config patch (issue 043), against a real
 * daemon process on an isolated home. The daemon under test runs from the repo build,
 * so the npm-global origin guard must reject the install — that is the assertion: the
 * patch pipe reaches the service manager path and the guard fires with an actionable
 * message rather than a silent success or a crash.
 */

const tempHomes: string[] = [];

afterEach(async () => {
  while (tempHomes.length > 0) {
    const dir = tempHomes.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("daemon service config patch (issue 043)", () => {
  it("surfaces a service view in the daemon config", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "byspace-svc-e2e-"));
    tempHomes.push(home);
    const ctx = await createDaemonTestContext({ home });
    try {
      const { config } = await ctx.client.getDaemonConfig();
      const service = (config as { service?: { state: string; label: string } }).service;
      expect(service).toBeDefined();
      expect([
        "not-installed",
        "installed-stopped",
        "installed-running-not-this-process",
        "managed-by-service",
        "unknown",
      ]).toContain(service?.state);
      expect(service?.label).toBe("cc.cd.byspace.daemon");
    } finally {
      await ctx.cleanup();
    }
  });

  it("rejects install from a non-npm-global daemon with an actionable error", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "byspace-svc-e2e-"));
    tempHomes.push(home);
    const ctx = await createDaemonTestContext({ home });
    try {
      await expect(ctx.client.patchDaemonConfig({ service: { install: true } })).rejects.toThrow(
        /npm -g|npm global|not running from/i,
      );
      // The rejection must not have created a service definition as a side effect.
      expect(existsSync(path.join(home, "Library", "LaunchAgents"))).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it("applies uninstall without an origin guard (removal is always safe)", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "byspace-svc-e2e-"));
    tempHomes.push(home);
    const ctx = await createDaemonTestContext({ home });
    try {
      // Uninstall is deliberately unguarded: removing a definition never creates one,
      // and it lets a dev-checkout daemon clean up a stale service from an old
      // npm-global install. Nothing is installed here, so the view stays not-installed.
      await ctx.client.patchDaemonConfig({ service: { install: false } });
      const { config } = await ctx.client.getDaemonConfig();
      const service = (config as { service?: { state: string } }).service;
      expect(service?.state).toBe("not-installed");
    } finally {
      await ctx.cleanup();
    }
  });
});
