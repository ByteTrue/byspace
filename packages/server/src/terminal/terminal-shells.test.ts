import { describe, expect, test } from "vitest";

import { getAvailableTerminalShells } from "./terminal-shells.js";

describe("getAvailableTerminalShells", () => {
  test("returns only available Windows shell commands", () => {
    expect(
      getAvailableTerminalShells("win32", (command) => ["pwsh.exe", "cmd.exe"].includes(command)),
    ).toEqual(["pwsh.exe", "cmd.exe"]);
  });

  test("uses POSIX shell names on non-Windows hosts", () => {
    expect(getAvailableTerminalShells("linux", (command) => command === "bash")).toEqual(["bash"]);
  });
});
