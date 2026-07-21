import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installRegisteredAgentHook } from "./provider-registry.js";

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

describe("terminal agent hook provider registry", () => {
  it("logs and returns null when a provider hook cannot be installed", () => {
    const configDir = join(createTempDir("byspace-agent-hook-registry-"), "not-a-directory");
    const entries: Array<{ bindings: Record<string, unknown>; message: string }> = [];
    writeFileSync(configDir, "");

    expect(
      installRegisteredAgentHook("claude", {
        configDir,
        logger: {
          warn(bindings, message) {
            entries.push({ bindings, message });
          },
        },
      }),
    ).toBeNull();
    expect(entries).toEqual([
      {
        bindings: expect.objectContaining({ err: expect.any(Error), provider: "claude" }),
        message: "Failed to install terminal activity hook provider",
      },
    ]);
  });
});
