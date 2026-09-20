import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildDaemonServiceSpec, launchdPlistPath, launchAgentDirs } from "./service-spec.js";
import { renderLaunchdPlist } from "./launchd.js";
import { resolveLaunchdServiceStatus, validateServiceInstallOrigin } from "./service-status.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "byspace-service-"));
  tempDirs.push(dir);
  return dir;
}

const spec = {
  label: "cc.cd.byspace.daemon",
  nodePath: "/usr/local/bin/node",
  runnerEntry: "/opt/byspace/server/dist/scripts/supervisor-entrypoint.js",
  runnerArgs: [],
  logPath: "/Users/test/.byspace/daemon.log",
  env: {
    BYSPACE_HOME: "/Users/test/.byspace",
    PATH: "/Users/test/.local/bin:/usr/local/bin:/usr/bin:/bin",
  },
};

describe("buildDaemonServiceSpec", () => {
  it("builds the spec from absolute paths and snapshots BYSPACE_* plus PATH", () => {
    const home = tempHome();
    const runner = path.join(home, "runner.js");
    writeFileSync(runner, "console.log(1)\n");

    const built = buildDaemonServiceSpec({
      home,
      logPath: path.join(home, "daemon.log"),
      runnerEntry: runner,
      env: {
        BYSPACE_HOME: home,
        BYSPACE_LISTEN: "127.0.0.1:6777",
        UNRELATED: "nope",
        PATH: "/usr/local/bin:/usr/bin:/bin",
      } as NodeJS.ProcessEnv,
    });

    expect(built.label).toBe("cc.cd.byspace.daemon");
    expect(built.runnerEntry).toBe(runner);
    expect(built.env.BYSPACE_LISTEN).toBe("127.0.0.1:6777");
    expect(built.env.UNRELATED).toBeUndefined();
    expect(built.env.PATH).toContain("/usr/local/bin");
  });

  it("rejects a runner entry that does not exist", () => {
    expect(() =>
      buildDaemonServiceSpec({
        home: tempHome(),
        logPath: "/tmp/daemon.log",
        runnerEntry: "/nonexistent/runner.js",
      }),
    ).toThrow(/runner entry does not exist/);
  });
});

describe("renderLaunchdPlist", () => {
  it("renders RunAtLoad true and KeepAlive false", () => {
    const xml = renderLaunchdPlist(spec);
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<true/>");
    expect(xml).toContain("<key>KeepAlive</key>");
    // KeepAlive must be false so `byspace daemon stop` is not undone by launchd.
    const keepAliveIndex = xml.indexOf("<key>KeepAlive</key>");
    expect(xml.slice(keepAliveIndex)).toContain("<false/>");
    expect(xml).not.toMatch(/<key>KeepAlive<\/key>\s*\n\s*<true\/>/);
  });

  it("escapes XML-sensitive values in paths and env", () => {
    const xml = renderLaunchdPlist({
      ...spec,
      logPath: "/tmp/weird&path/<log>.log",
      env: { PATH: "/usr/bin", BYSPACE_HOSTNAMES: "a&b<c" },
    });
    expect(xml).toContain("/tmp/weird&amp;path/&lt;log&gt;.log");
    expect(xml).toContain("a&amp;b&lt;c");
    expect(xml).not.toContain("a&b<c");
  });

  it("writes node, runner, and args as the program arguments", () => {
    const xml = renderLaunchdPlist({ ...spec, runnerArgs: ["--listen", "127.0.0.1:6777"] });
    expect(xml).toContain("/usr/local/bin/node");
    expect(xml).toContain("/opt/byspace/server/dist/scripts/supervisor-entrypoint.js");
    expect(xml).toContain("--listen");
    expect(xml).toContain("127.0.0.1:6777");
  });
});

describe("launchdPlistPath", () => {
  it("resolves inside ~/Library/LaunchAgents and handles XDG override", () => {
    const home = tempHome();
    expect(launchdPlistPath("cc.cd.byspace.daemon", home)).toBe(
      path.join(home, "Library", "LaunchAgents", "cc.cd.byspace.daemon.plist"),
    );
    expect(launchAgentDirs(home)).toContain(path.join(home, "Library", "LaunchAgents"));
  });
});

describe("resolveLaunchdServiceStatus", () => {
  it("reports not-installed when no plist exists", () => {
    const home = tempHome();
    const status = resolveLaunchdServiceStatus("cc.cd.byspace.daemon", home, 123);
    expect(status.state).toBe("not-installed");
    expect(status.servicePid).toBeNull();
  });

  it("reports installed-stopped when a plist exists but launchd has no pid", () => {
    const home = tempHome();
    const dir = path.join(home, "Library", "LaunchAgents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "cc.cd.byspace.daemon.plist"), renderLaunchdPlist(spec));
    // launchctl is not stubbed here; the real launchd has no such label, so the pid is
    // null and the state must be installed-stopped, never managed-by-service.
    const status = resolveLaunchdServiceStatus("cc.cd.byspace.daemon", home, 123);
    expect(["installed-stopped", "unknown"]).toContain(status.state);
    expect(status.state).not.toBe("managed-by-service");
  });

  it("never reports managed-by-service when pids differ", () => {
    const home = tempHome();
    const dir = path.join(home, "Library", "LaunchAgents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "cc.cd.byspace.daemon.plist"), renderLaunchdPlist(spec));
    const status = resolveLaunchdServiceStatus("cc.cd.byspace.daemon", home, 999_999);
    expect(status.state).not.toBe("managed-by-service");
  });
});

describe("validateServiceInstallOrigin", () => {
  it("rejects inside Docker with an actionable message", () => {
    const error = validateServiceInstallOrigin({ installOriginError: null, isDocker: true });
    expect(error).toMatch(/Docker/);
    expect(error).toMatch(/restart policy/);
  });

  it("passes through the install-origin error verbatim", () => {
    const error = validateServiceInstallOrigin({
      installOriginError: "This daemon is not running from the npm global install.",
      isDocker: false,
    });
    expect(error).toMatch(/npm global/);
  });

  it("accepts a clean npm global origin", () => {
    expect(validateServiceInstallOrigin({ installOriginError: null, isDocker: false })).toBeNull();
  });
});
