import { mkdtemp, open, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  acquirePidLock,
  getPidLockInfo,
  isLocked,
  PidLockError,
  refreshPidLock,
  releasePidLock,
  updatePidLock,
} from "./pid-lock.js";

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
      expect(lock?.heartbeat).toBe(true);

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

  test("keeps a stale heartbeat lock when the recorded pid is alive without a reachability check", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-stale-heartbeat-"));
    const replacementOwnerPid = process.pid + 10_000;

    try {
      const pidPath = join(byspaceHome, "byspace.pid");
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: "2026-01-01T00:00:00.000Z",
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6777",
          desktopManaged: true,
          heartbeat: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await expect(isLocked(byspaceHome)).resolves.toMatchObject({ locked: true });
      await expect(
        acquirePidLock(byspaceHome, null, { ownerPid: replacementOwnerPid }),
      ).rejects.toThrow("Another BySpace daemon is already running");

      const lock = await getPidLockInfo(byspaceHome);
      expect(lock?.pid).toBe(process.pid);
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });

  test("reclaims a stale desktop heartbeat lock after desktop confirms the daemon is unreachable", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-stale-desktop-heartbeat-"));
    const replacementOwnerPid = process.pid + 10_000;

    try {
      const pidPath = join(byspaceHome, "byspace.pid");
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: "2026-01-01T00:00:00.000Z",
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6777",
          desktopManaged: true,
          heartbeat: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await acquirePidLock(byspaceHome, null, {
        ownerPid: replacementOwnerPid,
        reclaimStaleDesktopLock: true,
      });

      const lock = await getPidLockInfo(byspaceHome);
      expect(lock?.pid).toBe(replacementOwnerPid);
      expect(lock?.listen).toBeNull();
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });

  test("keeps a stale live lock written by a pre-heartbeat daemon", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-legacy-live-"));
    const pidPath = join(byspaceHome, "byspace.pid");

    try {
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: "2026-01-01T00:00:00.000Z",
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6777",
          desktopManaged: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await expect(
        acquirePidLock(byspaceHome, null, { ownerPid: process.pid + 10_000 }),
      ).rejects.toThrow("Another BySpace daemon is already running");

      const lock = await getPidLockInfo(byspaceHome);
      expect(lock?.pid).toBe(process.pid);
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });

  test("reclaims a stale legacy desktop lock after desktop confirms the daemon is unreachable", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-legacy-desktop-"));
    const replacementOwnerPid = process.pid + 10_000;
    const pidPath = join(byspaceHome, "byspace.pid");

    try {
      await writeFile(
        pidPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: "2026-01-01T00:00:00.000Z",
          hostname: "old-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6777",
          desktopManaged: true,
        }),
      );
      const staleTime = new Date(Date.now() - 10 * 60_000);
      await utimes(pidPath, staleTime, staleTime);

      await acquirePidLock(byspaceHome, null, {
        ownerPid: replacementOwnerPid,
        reclaimStaleDesktopLock: true,
      });

      const lock = await getPidLockInfo(byspaceHome);
      expect(lock?.pid).toBe(replacementOwnerPid);
      expect(lock?.heartbeat).toBe(true);
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });

  test("rejects a heartbeat refresh after another supervisor takes ownership", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-refresh-owner-"));

    try {
      await acquirePidLock(byspaceHome, null, { ownerPid: process.pid + 10_000 });

      await expect(refreshPidLock(byspaceHome, { ownerPid: process.pid })).rejects.toBeInstanceOf(
        PidLockError,
      );
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });

  test("retries a heartbeat refresh while its owner is rewriting the lock", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-refresh-rewrite-"));
    const pidPath = join(byspaceHome, "byspace.pid");

    try {
      await acquirePidLock(byspaceHome, null, { ownerPid: process.pid });
      const lock = await getPidLockInfo(byspaceHome);
      expect(lock).not.toBeNull();

      const rewriteHandle = await open(pidPath, "r+");
      await rewriteHandle.truncate(0);

      const refresh = refreshPidLock(byspaceHome, { ownerPid: process.pid });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await rewriteHandle.writeFile(JSON.stringify(lock));
      await rewriteHandle.close();

      await expect(refresh).resolves.toBeUndefined();
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });

  test("keeps a fresh lock when the recorded pid is alive", async () => {
    const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-pid-lock-fresh-heartbeat-"));

    try {
      await writeFile(
        join(byspaceHome, "byspace.pid"),
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          hostname: "current-host",
          uid: process.getuid?.() ?? 0,
          listen: "127.0.0.1:6777",
          desktopManaged: true,
          heartbeat: true,
        }),
      );

      await expect(
        acquirePidLock(byspaceHome, null, { ownerPid: process.pid + 10_000 }),
      ).rejects.toThrow("Another BySpace daemon is already running");

      const lock = await getPidLockInfo(byspaceHome);
      expect(lock?.pid).toBe(process.pid);
      expect(lock?.listen).toBe("127.0.0.1:6777");
    } finally {
      await rm(byspaceHome, { recursive: true, force: true });
    }
  });
});
