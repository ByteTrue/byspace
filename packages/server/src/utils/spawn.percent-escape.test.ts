import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { execCommand } from "./spawn.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeEchoArgScript(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "byspace-percent-escape-"));
  tempDirs.push(dir);
  const scriptPath = path.join(dir, "echo-arg.js");
  writeFileSync(scriptPath, "process.stdout.write(process.argv[2] ?? '');\n");
  return scriptPath;
}

const FORMATS = [
  { label: "a git for-each-ref --format atom", arg: "--format=%(refname)%09%(committerdate:unix)" },
  { label: "a bare percent-prefixed token", arg: "%(refname)" },
];

describe("spawn argument escaping for % characters", () => {
  // A bare command name used to be routed through cmd.exe, which is where the
  // %-doubling bug lived. It no longer is, so this covers the argv path.
  for (const { label, arg } of FORMATS) {
    test(`delivers ${label} to the child verbatim`, async () => {
      const scriptPath = writeEchoArgScript();

      const { stdout } = await execCommand("node", [scriptPath, arg]);

      expect(stdout).toBe(arg);
    });
  }

  // cmd.exe is still how batch launchers run, so the %-escaping rules are
  // asserted there too. `shell: true` is what puts the spawn behind cmd.exe;
  // without it these calls would quietly stop exercising `quoteWindowsArgument`.
  test.runIf(process.platform === "win32")(
    "delivers % characters verbatim when the spawn goes through cmd.exe",
    async () => {
      const scriptPath = writeEchoArgScript();

      for (const { arg } of FORMATS) {
        const { stdout } = await execCommand("node", [scriptPath, arg], { shell: true });

        expect(stdout).toBe(arg);
      }
    },
  );
});
