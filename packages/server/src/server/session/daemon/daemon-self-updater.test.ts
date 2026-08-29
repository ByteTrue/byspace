import { describe, expect, test } from "vitest";
import {
  DaemonSelfUpdateInProgressError,
  DaemonSelfUpdater,
  type DaemonSelfUpdateRuntime,
  type DaemonSelfUpdatePhase,
} from "./daemon-self-updater.js";
import type { CommandResult, NpmGlobalBySpaceInstall } from "./npm-global-cli.js";

interface TestLogger {
  errors: Array<{ obj: object; msg?: string }>;
  warnings: Array<{ obj: object; msg?: string }>;
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

type Inspection = NpmGlobalBySpaceInstall | Error;
type RuntimeCall = "inspect" | "install:latest" | "install:beta";

const globalRoot = "/global/lib";
const globalNodeModules = `${globalRoot}/node_modules`;
const cliPackagePath = `${globalNodeModules}/@bytetrue/byspace`;
const npmServerPackageRoot = `${cliPackagePath}/node_modules/@bytetrue/byspace-server`;
const sourceServerPackageRoot = "/repo/packages/server";

function npmGlobalBySpaceInstall(
  version: string,
  options?: { linked?: boolean },
): NpmGlobalBySpaceInstall {
  return {
    version,
    packagePath: cliPackagePath,
    globalRootPath: globalRoot,
    isLinked: options?.linked === true,
  };
}

function createLogger(): TestLogger {
  return {
    errors: [],
    warnings: [],
    error(obj, msg) {
      this.errors.push({ obj, msg });
    },
    warn(obj, msg) {
      this.warnings.push({ obj, msg });
    },
  };
}

function createRuntime(input: {
  inspections: Inspection[];
  currentServerPackageRoot?: string | null;
  installResult?: CommandResult;
  calls?: RuntimeCall[];
}): DaemonSelfUpdateRuntime {
  const calls = input.calls ?? [];
  return {
    npm: {
      async inspect() {
        calls.push("inspect");
        const inspection = input.inspections.shift();
        if (!inspection) {
          throw new Error("Unexpected npm global install inspection");
        }
        if (inspection instanceof Error) {
          throw inspection;
        }
        return inspection;
      },
      async install(distTag) {
        calls.push(`install:${distTag}`);
        return input.installResult ?? { exitCode: 0, stdout: "changed 42 packages", stderr: "" };
      },
    },
    installOrigin: {
      resolveCurrentServerPackageRoot() {
        return input.currentServerPackageRoot ?? npmServerPackageRoot;
      },
    },
  };
}

async function runUpdate(input: {
  runtime: DaemonSelfUpdateRuntime;
  daemonVersion?: string | null;
  phases?: DaemonSelfUpdatePhase[];
}) {
  const logger = createLogger();
  const updater = new DaemonSelfUpdater(input.runtime);
  const phases = input.phases ?? [];
  const result = await updater.update({
    daemonVersion: input.daemonVersion === undefined ? "0.1.15" : input.daemonVersion,
    onProgress: (phase) => phases.push(phase),
    logger,
  });
  return { result, logger, phases };
}

describe("DaemonSelfUpdater", () => {
  test("updates a daemon that is running from the npm global cli install", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      inspections: [npmGlobalBySpaceInstall("0.1.15"), npmGlobalBySpaceInstall("0.1.96")],
    });

    const { result, phases } = await runUpdate({ runtime });

    expect(result).toEqual({
      success: true,
      error: null,
      newVersion: "0.1.96",
    });
    expect(phases).toEqual(["starting", "downloading", "installing", "complete"]);
    expect(calls).toEqual(["inspect", "install:latest", "inspect"]);
  });

  test("updates beta daemons from the npm beta tag", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      inspections: [
        npmGlobalBySpaceInstall("0.2.0-beta.1"),
        npmGlobalBySpaceInstall("0.2.0-beta.2"),
      ],
    });

    const { result } = await runUpdate({ runtime, daemonVersion: "0.2.0-beta.1" });

    expect(result).toEqual({ success: true, error: null, newVersion: "0.2.0-beta.2" });
    expect(calls).toEqual(["inspect", "install:beta", "inspect"]);
  });

  test.each([
    [null, "Cannot self-update because the running daemon version is unavailable."],
    ["not-semver", "Invalid BySpace release version: not-semver"],
  ])("does not install when the running daemon version is %s", async (daemonVersion, error) => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({ calls, inspections: [] });

    const update = await runUpdate({ runtime, daemonVersion });

    expect(update.result).toEqual({ success: false, error, newVersion: null });
    expect(calls).toEqual([]);
  });

  test("does not run install when npm global cli is missing", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      inspections: [new Error("@bytetrue/byspace is not installed with npm -g on this host")],
    });

    const { result, phases } = await runUpdate({ runtime });

    expect(result.success).toBe(false);
    expect(result.error).toBe("@bytetrue/byspace is not installed with npm -g on this host");
    expect(phases).toEqual(["starting"]);
    expect(calls).toEqual(["inspect"]);
  });

  test("does not update a daemon whose version does not match the npm global cli", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      inspections: [npmGlobalBySpaceInstall("0.1.15")],
    });

    const { result } = await runUpdate({ runtime, daemonVersion: "0.1.96" });

    expect(result).toEqual({
      success: false,
      error:
        "This daemon is not running from the npm global @bytetrue/byspace install (global npm has 0.1.15, daemon is 0.1.96).",
      newVersion: null,
    });
    expect(calls).toEqual(["inspect"]);
  });

  test("does not update a daemon running outside the npm global package tree", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      currentServerPackageRoot: sourceServerPackageRoot,
      inspections: [npmGlobalBySpaceInstall("0.1.15")],
    });

    const { result } = await runUpdate({ runtime });

    expect(result).toEqual({
      success: false,
      error: "This daemon is not running from the npm global @bytetrue/byspace install.",
      newVersion: null,
    });
    expect(calls).toEqual(["inspect"]);
  });

  test("does not update linked global installs", async () => {
    const runtime = createRuntime({
      inspections: [npmGlobalBySpaceInstall("0.1.15", { linked: true })],
    });

    const { result } = await runUpdate({ runtime });

    expect(result).toEqual({
      success: false,
      error:
        "The global @bytetrue/byspace install is linked; self-update only supports normal npm global installs.",
      newVersion: null,
    });
  });

  test("rejects concurrent update requests", async () => {
    const calls: RuntimeCall[] = [];
    let resolveInstall: ((result: CommandResult) => void) | null = null;
    let installStartedResolve: (() => void) | null = null;
    const installStarted = new Promise<void>((resolve) => {
      installStartedResolve = resolve;
    });
    const runtime: DaemonSelfUpdateRuntime = {
      npm: {
        async inspect() {
          calls.push("inspect");
          return npmGlobalBySpaceInstall("0.1.15");
        },
        async install(distTag) {
          calls.push(`install:${distTag}`);
          installStartedResolve?.();
          return new Promise<CommandResult>((resolve) => {
            resolveInstall = resolve;
          });
        },
      },
      installOrigin: {
        resolveCurrentServerPackageRoot() {
          return npmServerPackageRoot;
        },
      },
    };
    const logger = createLogger();
    const updater = new DaemonSelfUpdater(runtime);

    const firstUpdate = updater.update({
      daemonVersion: "0.1.15",
      onProgress: () => {},
      logger,
    });
    await installStarted;

    await expect(
      updater.update({
        daemonVersion: "0.1.15",
        onProgress: () => {},
        logger,
      }),
    ).rejects.toBeInstanceOf(DaemonSelfUpdateInProgressError);

    resolveInstall?.({ exitCode: 0, stdout: "updated", stderr: "" });
    await expect(firstUpdate).resolves.toMatchObject({ success: true });
    expect(calls).toEqual(["inspect", "install:latest", "inspect"]);
  });
});
