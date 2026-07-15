import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { acquirePidLock, getPidLockInfo, releasePidLock, updatePidLock } from "./pid-lock.js";

describe("pid-lock ownership", () => {
  test("writes and releases lock for explicit owner pid", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-owner-"));
    const ownerPid = process.pid + 10_000;

    try {
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number },
        ) => Promise<void>
      )(byspaceHome, null, { ownerPid });

      const lock = await getPidLockInfo(byspaceHome);
      expect(lock?.pid).toBe(ownerPid);
      expect(lock?.listen).toBeNull();

      await (
        updatePidLock as unknown as (
          home: string,
          patch: { listen: string },
          options: { ownerPid: number },
        ) => Promise<void>
      )(byspaceHome, { listen: "127.0.0.1:6777" }, { ownerPid });

      const updatedLock = await getPidLockInfo(byspaceHome);
      expect(updatedLock?.listen).toBe("127.0.0.1:6777");

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(byspaceHome, { ownerPid: ownerPid + 1 });
      const lockAfterWrongOwnerRelease = await getPidLockInfo(byspaceHome);
      expect(lockAfterWrongOwnerRelease?.pid).toBe(ownerPid);

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(byspaceHome, { ownerPid });
      const lockAfterOwnerRelease = await getPidLockInfo(byspaceHome);
      expect(lockAfterOwnerRelease).toBeNull();
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });
});
