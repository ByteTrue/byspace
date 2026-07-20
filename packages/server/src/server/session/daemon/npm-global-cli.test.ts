import path from "node:path";
import { describe, expect, test } from "vitest";
import { DefaultNpmGlobalBySpaceCli } from "./npm-global-cli.js";

interface CommandCall {
  command: string;
  args: string[];
  timeout?: number;
  maxBuffer?: number;
}

const globalRoot = path.join(path.sep, "global", "lib");
const globalNodeModules = path.join(globalRoot, "node_modules");
const cliPackagePath = path.join(globalNodeModules, "@bytetrue", "byspace");

function npmGlobalBySpaceCliJson(version: string, options?: { linked?: boolean }): string {
  return JSON.stringify({
    name: "lib",
    path: globalRoot,
    dependencies: {
      "@bytetrue/byspace": {
        version,
        path: cliPackagePath,
        link: options?.linked === true,
      },
    },
  });
}

describe("DefaultNpmGlobalBySpaceCli", () => {
  test("inspects the npm global cli install with npm -g ls", async () => {
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalBySpaceCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: npmGlobalBySpaceCliJson("0.1.15"), stderr: "" };
    });

    await expect(cli.inspect()).resolves.toEqual({
      version: "0.1.15",
      packagePath: cliPackagePath,
      globalRootPath: globalRoot,
      isLinked: false,
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["-g", "ls", "@bytetrue/byspace", "--json", "--depth=0", "--long"],
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test.each([
    ["latest", "@bytetrue/byspace@latest"],
    ["beta", "@bytetrue/byspace@beta"],
  ] as const)("runs the global install command for the %s cli", async (distTag, packageSpec) => {
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalBySpaceCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: "changed 42 packages", stderr: "" };
    });

    await expect(cli.install(distTag)).resolves.toEqual({
      exitCode: 0,
      stdout: "changed 42 packages",
      stderr: "",
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["install", "-g", packageSpec],
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test("reports missing npm when npm exits without JSON", async () => {
    const cli = new DefaultNpmGlobalBySpaceCli(async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "npm: command not found",
    }));

    await expect(cli.inspect()).rejects.toThrow("npm: command not found");
  });

  test("reports missing global cli when npm output has no cli dependency", async () => {
    const cli = new DefaultNpmGlobalBySpaceCli(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ name: "lib", path: globalRoot, dependencies: {} }),
      stderr: "missing",
    }));

    await expect(cli.inspect()).rejects.toThrow(
      "@bytetrue/byspace is not installed with npm -g on this host",
    );
  });
});
