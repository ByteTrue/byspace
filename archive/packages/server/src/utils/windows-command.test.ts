import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import { execCommand } from "./spawn.js";
import {
  parsePathExtSuffixes,
  resolveWindowsExecutable,
  windowsCommandNeedsShell,
} from "./windows-command.js";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function pathValue(...directories: string[]): string {
  return directories.join(path.delimiter);
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parsePathExtSuffixes", () => {
  test("falls back to the Windows default order", () => {
    expect(parsePathExtSuffixes(undefined)).toEqual([".com", ".exe", ".bat", ".cmd"]);
    expect(parsePathExtSuffixes("  ")).toEqual([".com", ".exe", ".bat", ".cmd"]);
  });

  test("lowercases, trims and dedupes the configured list", () => {
    expect(parsePathExtSuffixes(".EXE;.COM;.exe;.bat")).toEqual([".exe", ".com", ".bat"]);
  });
});

describe("resolveWindowsExecutable", () => {
  const suffixes = [".com", ".exe", ".bat", ".cmd"];

  test("walks PATH in order and tries each PATHEXT suffix", () => {
    const target = path.join("second", "tool.exe");
    expect(
      resolveWindowsExecutable("tool", {
        pathValue: pathValue("first", "second"),
        suffixes,
        fileExists: (candidate) => candidate === target,
      }),
    ).toBe(target);
  });

  test("prefers the earlier PATHEXT suffix when several launchers exist", () => {
    const exists = new Set([path.join("bin", "tool.exe"), path.join("bin", "tool.cmd")]);
    expect(
      resolveWindowsExecutable("tool", {
        pathValue: "bin",
        suffixes,
        fileExists: (candidate) => exists.has(candidate),
      }),
    ).toBe(path.join("bin", "tool.exe"));
  });

  test("returns null for an extensionless shim so the caller keeps the shell", () => {
    const dir = tempDir("byspace-win-shim-");
    expect(
      resolveWindowsExecutable("shim", {
        pathValue: dir,
        suffixes,
      }),
    ).toBeNull();
  });

  test("finds a real file on disk", () => {
    const dir = tempDir("byspace-win-resolve-");
    writeFileSync(path.join(dir, "probe-tool.exe"), "");
    expect(
      resolveWindowsExecutable("probe-tool", {
        pathValue: dir,
        suffixes: parsePathExtSuffixes(undefined),
      }),
    ).toBe(path.join(dir, "probe-tool.exe"));
  });
});

describe("windowsCommandNeedsShell", () => {
  const dir = tempDir("byspace-win-shell-");
  writeFileSync(path.join(dir, "real-tool.exe"), "");
  writeFileSync(path.join(dir, "batch-tool.cmd"), "");
  writeFileSync(path.join(dir, "script-tool.ps1"), "");
  const native = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };

  test("spawns a native binary directly", () => {
    expect(windowsCommandNeedsShell("real-tool", native)).toBe(false);
  });

  test("keeps a batch launcher on the shell", () => {
    expect(windowsCommandNeedsShell("batch-tool", native)).toBe(true);
  });

  test("keeps a name the resolver cannot see on the shell", () => {
    expect(windowsCommandNeedsShell("absent-tool", native)).toBe(true);
  });

  test("keeps a script host listed in PATHEXT on the shell", () => {
    // PowerShell resolves through cmd.exe; CreateProcess cannot run it.
    const withScriptHost = { PATH: dir, PATHEXT: ".COM;.EXE;.PS1;.BAT;.CMD" };
    expect(windowsCommandNeedsShell("script-tool", withScriptHost)).toBe(true);
    expect(windowsCommandNeedsShell("real-tool", withScriptHost)).toBe(false);
  });
});

describe("execCommand argument fidelity", () => {
  const echoArg = (() => {
    const dir = tempDir("byspace-arg-fidelity-");
    const scriptPath = path.join(dir, "echo-arg.js");
    writeFileSync(scriptPath, "process.stdout.write(process.argv[2] ?? '');\n");
    return scriptPath;
  })();

  // A bare command name is the shape the forge CLIs use. It used to go through
  // cmd.exe, which ends its command line at the first newline and silently
  // truncated the argument - GraphQL queries were the victim.
  test("delivers a multi-line argument to a bare command name intact", async () => {
    const argument = "query Q {\n  rateLimit {\n    remaining\n  }\n}";

    const { stdout } = await execCommand("node", [echoArg, argument]);

    expect(stdout).toBe(argument);
  });
});

test.runIf(process.platform === "win32")(
  "execCommand runs a batch launcher through the shell",
  async () => {
    const dir = tempDir("byspace-cmd-launcher-");
    writeFileSync(path.join(dir, "byspace-sayhi.cmd"), "@echo off\r\necho hi-from-cmd\r\n");

    const { stdout } = await execCommand("byspace-sayhi", [], {
      env: {
        ...process.env,
        PATH: pathValue(dir, process.env.PATH ?? ""),
      } as Record<string, string>,
      timeout: 30_000,
    });

    expect(stdout).toContain("hi-from-cmd");
  },
);

describe("forge binaries installed on this machine", () => {
  for (const binary of ["gh", "glab", "tea"]) {
    const resolved = resolveWindowsExecutable(binary, {
      pathValue: process.env.PATH,
      suffixes: parsePathExtSuffixes(process.env.PATHEXT),
    });

    test.runIf(Boolean(resolved))(`${resolved} runs without the shell`, async () => {
      expect(windowsCommandNeedsShell(binary, process.env)).toBe(false);

      const { stdout } = await execCommand(binary, ["--version"], { timeout: 30_000 });

      expect(stdout.trim()).not.toBe("");
    });
  }
});
