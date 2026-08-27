import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveBySpaceHome } from "./byspace-home.js";
import { PRIVATE_DIRECTORY_MODE } from "./private-files.js";

const MODE_MASK = 0o777;

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("resolveBySpaceHome permissions", () => {
  test("creates BYSPACE_HOME with private permissions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "byspace-home-parent-"));
    const byspaceHome = path.join(parent, "home");
    try {
      expect(resolveBySpaceHome({ BYSPACE_HOME: byspaceHome })).toBe(byspaceHome);
      expect(modeOf(byspaceHome)).toBe(PRIVATE_DIRECTORY_MODE);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
