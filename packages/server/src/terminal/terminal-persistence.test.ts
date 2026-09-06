import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalManager, type TerminalManager } from "./terminal-manager.js";
import type { TerminalSession } from "./terminal.js";
import {
  createPersistingTerminalManager,
  restorePersistedTerminals,
} from "./terminal-persistence.js";
import { TerminalSessionStore } from "./terminal-session-store.js";
import { createTestLogger } from "../test-utils/test-logger.js";

const logger = createTestLogger();

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

function readStoreRecords(filePath: string): Array<Record<string, unknown>> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
}

const temporaryDirs: string[] = [];
const managers: TerminalManager[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    manager.killAll();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBUSY") {
          throw error;
        }
      }
    }
  }
});

function createStore(): { store: TerminalSessionStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "byspace-terminal-persist-"));
  temporaryDirs.push(dir);
  const filePath = join(dir, "terminals.json");
  return { store: new TerminalSessionStore(filePath), filePath };
}

function createWorkspaceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "byspace-terminal-persist-ws-"));
  temporaryDirs.push(dir);
  return dir;
}

describe("persisting terminal manager", () => {
  it("persists created terminal metadata including command and args", async () => {
    const cwd = createWorkspaceDir();
    const { store, filePath } = createStore();
    const wrapper = createPersistingTerminalManager({
      inner: createTerminalManager(),
      store,
      logger,
    });
    managers.push(wrapper);

    const shell = await wrapper.createTerminal({ cwd, workspaceId: "ws-1" });
    const scripted = await wrapper.createTerminal({
      cwd,
      workspaceId: "ws-1",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });

    await waitForCondition(() => readStoreRecords(filePath)?.length === 2, 10000);
    expect(readStoreRecords(filePath)).toEqual([
      { id: shell.id, cwd, workspaceId: "ws-1", name: shell.name },
      {
        id: scripted.id,
        cwd,
        workspaceId: "ws-1",
        name: scripted.name,
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
    ]);
  });

  it("mirrors removals when a terminal exits on its own", async () => {
    const cwd = createWorkspaceDir();
    const { store, filePath } = createStore();
    const wrapper = createPersistingTerminalManager({
      inner: createTerminalManager(),
      store,
      logger,
    });
    managers.push(wrapper);

    await wrapper.createTerminal({
      cwd,
      workspaceId: "ws-1",
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 300)"],
    });

    await waitForCondition(() => readStoreRecords(filePath)?.length === 1, 10000);
    await waitForCondition(() => readStoreRecords(filePath)?.length === 0, 10000);
  });

  it("does not persist terminals that exit before create resolves", async () => {
    const cwd = createWorkspaceDir();
    const { store, filePath } = createStore();
    const wrapper = createPersistingTerminalManager({
      inner: createTerminalManager(),
      store,
      logger,
    });
    managers.push(wrapper);

    await wrapper.createTerminal({
      cwd,
      workspaceId: "ws-1",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(readStoreRecords(filePath) ?? []).toEqual([]);
  });

  it("mirrors removals on killTerminalAndWait", async () => {
    const cwd = createWorkspaceDir();
    const { store, filePath } = createStore();
    const wrapper = createPersistingTerminalManager({
      inner: createTerminalManager(),
      store,
      logger,
    });
    managers.push(wrapper);

    const terminal = await wrapper.createTerminal({
      cwd,
      workspaceId: "ws-1",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    await waitForCondition(() => readStoreRecords(filePath)?.length === 1, 10000);

    await wrapper.killTerminalAndWait(terminal.id);
    await waitForCondition(() => readStoreRecords(filePath)?.length === 0, 10000);
  });

  it("keeps records across killAll so the next boot can restore them", async () => {
    const cwd = createWorkspaceDir();
    const { store, filePath } = createStore();
    const wrapper = createPersistingTerminalManager({
      inner: createTerminalManager(),
      store,
      logger,
    });
    managers.push(wrapper);

    const terminal = await wrapper.createTerminal({
      cwd,
      workspaceId: "ws-1",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    await waitForCondition(() => readStoreRecords(filePath)?.length === 1, 10000);

    wrapper.killAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readStoreRecords(filePath)).toEqual([
      {
        id: terminal.id,
        cwd,
        workspaceId: "ws-1",
        name: terminal.name,
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
    ]);
  });
});

describe("restorePersistedTerminals", () => {
  it("recreates tabs with their original ids after a daemon restart", async () => {
    const cwd = createWorkspaceDir();
    const { store, filePath } = createStore();

    // First boot: user opens a terminal, then the daemon shuts down (or dies).
    const firstBoot = createPersistingTerminalManager({
      inner: createTerminalManager(),
      store,
      logger,
    });
    managers.push(firstBoot);
    const terminal = await firstBoot.createTerminal({
      cwd,
      workspaceId: "ws-1",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    await waitForCondition(() => readStoreRecords(filePath)?.length === 1, 10000);
    firstBoot.killAll();

    // Second boot: a fresh manager must bring the tab back with the same id.
    const secondBoot = createPersistingTerminalManager({
      inner: createTerminalManager(),
      store,
      logger,
    });
    managers.push(secondBoot);
    expect(await secondBoot.getTerminals(cwd)).toEqual([]);

    await restorePersistedTerminals({
      manager: secondBoot,
      store,
      isWorkspaceActive: async () => true,
      logger,
    });

    const restored = await secondBoot.getTerminals(cwd);
    expect(restored.map((session) => session.id)).toEqual([terminal.id]);
    expect(restored.map((session) => session.name)).toEqual([terminal.name]);
    await waitForCondition(() => readStoreRecords(filePath)?.length === 1, 10000);
    expect(readStoreRecords(filePath)?.[0]).toMatchObject({ id: terminal.id, cwd });
  });

  it("drops records whose workspace is gone or whose cwd no longer exists", async () => {
    const liveCwd = realpathSync(tmpdir());
    const missingCwd = join(liveCwd, "byspace-restore-test-does-not-exist");
    const records = [
      { id: "keep-1", cwd: liveCwd, workspaceId: "ws-live", name: "Terminal 1" },
      { id: "drop-cwd", cwd: missingCwd, workspaceId: "ws-live", name: "Terminal 2" },
      { id: "drop-archived", cwd: liveCwd, workspaceId: "ws-archived", name: "Terminal 3" },
      { id: "drop-missing", cwd: liveCwd, workspaceId: "ws-unknown", name: "Terminal 4" },
    ];
    const { store, filePath } = createStore();
    await store.replace(records);

    const created: TerminalSession[] = [];
    const stubManager = {
      createTerminal: async (options: { id?: string; name?: string }) => {
        const session = {
          id: options.id ?? "generated",
          name: options.name ?? "Terminal 1",
        } as TerminalSession;
        created.push(session);
        return session;
      },
    } as unknown as TerminalManager;

    await restorePersistedTerminals({
      manager: stubManager,
      store,
      isWorkspaceActive: async (workspaceId) => workspaceId === "ws-live",
      logger,
    });

    expect(created.map((session) => session.id)).toEqual(["keep-1"]);
    expect(readStoreRecords(filePath)).toEqual([records[0]]);
    expect(existsSync(missingCwd)).toBe(false);
  });
});
