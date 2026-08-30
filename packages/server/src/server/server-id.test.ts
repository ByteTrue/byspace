import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOrCreateServerId } from "./server-id.js";
import { PRIVATE_FILE_MODE } from "./private-files.js";

const MODE_MASK = 0o777;
const PERMISSIVE_FILE_MODE = 0o644;

function tmpHome(): string {
  return mkdtempSync(path.join(tmpdir(), "paseo-server-id-"));
}

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe("getOrCreateServerId", () => {
  let home: string;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BYSPACE_SERVER_ID;
    delete process.env.PASEO_SERVER_ID;
    home = tmpHome();
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(home, { recursive: true, force: true });
  });

  it("creates and persists a stable id per PASEO_HOME", () => {
    const first = getOrCreateServerId(home);
    const second = getOrCreateServerId(home);
    expect(first).toBe(second);
    expect(first.startsWith("srv_")).toBe(true);

    const idPath = path.join(home, "server-id");
    expect(existsSync(idPath)).toBe(true);
    expect(readFileSync(idPath, "utf8").trim()).toBe(first);
  });

  it("prefers and persists the BYSPACE_SERVER_ID override", () => {
    process.env.BYSPACE_SERVER_ID = "byspace-daemon-id";
    process.env.PASEO_SERVER_ID = "legacy-daemon-id";
    const id = getOrCreateServerId(home);
    expect(id).toBe("byspace-daemon-id");

    const idPath = path.join(home, "server-id");
    expect(existsSync(idPath)).toBe(true);
    expect(readFileSync(idPath, "utf8").trim()).toBe("byspace-daemon-id");
  });

  it("accepts and persists the legacy PASEO_SERVER_ID override", () => {
    process.env.PASEO_SERVER_ID = "legacy-daemon-id";
    const id = getOrCreateServerId(home);
    expect(id).toBe("legacy-daemon-id");

    const idPath = path.join(home, "server-id");
    expect(existsSync(idPath)).toBe(true);
    expect(readFileSync(idPath, "utf8").trim()).toBe("legacy-daemon-id");
  });

  describe.skipIf(process.platform === "win32")("file permissions", () => {
    it("creates server-id with private permissions", () => {
      getOrCreateServerId(home);

      expect(modeOf(path.join(home, "server-id"))).toBe(PRIVATE_FILE_MODE);
    });

    it("repairs existing server-id permissions when loading", () => {
      const idPath = path.join(home, "server-id");
      writeFileSync(idPath, "srv_existing\n", { mode: PERMISSIVE_FILE_MODE });
      chmodSync(idPath, PERMISSIVE_FILE_MODE);

      expect(getOrCreateServerId(home)).toBe("srv_existing");
      expect(modeOf(idPath)).toBe(PRIVATE_FILE_MODE);
    });

    it("repairs existing server-id permissions when using an env override", () => {
      const idPath = path.join(home, "server-id");
      process.env.PASEO_SERVER_ID = "test-daemon-id";
      writeFileSync(idPath, "srv_existing\n", { mode: PERMISSIVE_FILE_MODE });
      chmodSync(idPath, PERMISSIVE_FILE_MODE);

      expect(getOrCreateServerId(home)).toBe("test-daemon-id");
      expect(modeOf(idPath)).toBe(PRIVATE_FILE_MODE);
    });
  });
});
