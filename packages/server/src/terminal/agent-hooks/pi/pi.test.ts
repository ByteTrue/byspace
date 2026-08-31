import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentHooksAreInstalled,
  installAgentHooks,
  uninstallAgentHooks,
} from "../agent-hook-installer.js";
import { PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE } from "./pi-extension.js";
import { piAgentHookProvider } from "./pi.js";

const temporaryDirs: string[] = [];
const originalOwnerPid = process.env.BYSPACE_PI_TERMINAL_HOOK_OWNER_PID;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function loadInstalledExtension(): Promise<{
  default: (pi: { on(event: string, handler: (...args: unknown[]) => unknown): void }) => void;
}> {
  const dir = createTempDir("byspace-pi-extension-runtime-");
  const sourcePath = join(dir, "byspace-terminal-activity.mjs");
  writeFileSync(sourcePath, PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE, "utf8");
  return import(`${pathToFileURL(sourcePath).href}?test=${crypto.randomUUID()}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalOwnerPid === undefined) {
    delete process.env.BYSPACE_PI_TERMINAL_HOOK_OWNER_PID;
  } else {
    process.env.BYSPACE_PI_TERMINAL_HOOK_OWNER_PID = originalOwnerPid;
  }
  delete process.env.BYSPACE_TERMINAL_ACTIVITY_URL;
  delete process.env.BYSPACE_TERMINAL_ID;
  delete process.env.BYSPACE_ACTIVITY_TOKEN;
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Pi terminal agent hooks", () => {
  it("installs the auto-discovered extension idempotently and removes only that file", () => {
    const piHome = createTempDir("byspace-pi-hooks-");
    const options = { env: { PI_CODING_AGENT_DIR: piHome }, homeDir: "/unused" };
    const extensionPath = join(piHome, "extensions", "byspace-terminal-activity.ts");

    const first = installAgentHooks(piAgentHookProvider, options);
    const second = installAgentHooks(piAgentHookProvider, options);

    expect(first).toEqual({ configPath: extensionPath, changed: true });
    expect(second).toEqual({ configPath: extensionPath, changed: false });
    expect(readFileSync(extensionPath, "utf8")).toBe(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE);
    expect(agentHooksAreInstalled(piAgentHookProvider, options)).toBe(true);

    expect(uninstallAgentHooks(piAgentHookProvider, options)).toEqual({
      configPath: extensionPath,
      changed: true,
    });
    expect(existsSync(extensionPath)).toBe(false);
  });

  it("preserves a same-name extension that is not owned by BySpace", () => {
    const piHome = createTempDir("byspace-pi-hooks-foreign-");
    const options = { env: { PI_CODING_AGENT_DIR: piHome }, homeDir: "/unused" };
    const extensionPath = join(piHome, "extensions", "byspace-terminal-activity.ts");
    const foreignSource = "export default function customExtension() {}\n";
    mkdirSync(join(piHome, "extensions"), { recursive: true });
    writeFileSync(extensionPath, foreignSource, "utf8");

    expect(() => installAgentHooks(piAgentHookProvider, options)).toThrow(
      "Refusing to overwrite non-BySpace plugin file",
    );
    expect(uninstallAgentHooks(piAgentHookProvider, options)).toEqual({
      configPath: extensionPath,
      changed: false,
    });
    expect(readFileSync(extensionPath, "utf8")).toBe(foreignSource);
  });

  it.each([
    ["agent_start", "running"],
    ["ui_prompt_start", "needs-input"],
    ["ui_prompt_end", "running"],
    ["agent_settled", "idle"],
    ["session_shutdown", "idle"],
  ] as const)("maps %s to %s", async (event, state) => {
    await expect(
      piAgentHookProvider.resolveActivity({ event, input: { read: async () => null } }),
    ).resolves.toBe(state);
  });

  it("keeps one report in flight and sends only the latest queued state", async () => {
    delete process.env.BYSPACE_PI_TERMINAL_HOOK_OWNER_PID;
    process.env.BYSPACE_TERMINAL_ACTIVITY_URL = "http://127.0.0.1/activity";
    process.env.BYSPACE_TERMINAL_ID = "terminal-1";
    process.env.BYSPACE_ACTIVITY_TOKEN = "token-1";

    let releaseFirst!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    const extension = await loadInstalledExtension();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    extension.default({
      on(event, handler) {
        handlers.set(event, handler);
      },
    });

    handlers.get("agent_start")?.();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    handlers.get("ui_prompt_start")?.();
    const drained = handlers.get("session_shutdown")?.();
    releaseFirst();
    await drained;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const states = fetchMock.mock.calls.map(([, init]) => {
      return JSON.parse(String((init as RequestInit).body)).state;
    });
    expect(states).toEqual(["running", "idle"]);
  });

  it("continues with the latest queued state after a report fails", async () => {
    delete process.env.BYSPACE_PI_TERMINAL_HOOK_OWNER_PID;
    process.env.BYSPACE_TERMINAL_ACTIVITY_URL = "http://127.0.0.1/activity";
    process.env.BYSPACE_TERMINAL_ID = "terminal-1";
    process.env.BYSPACE_ACTIVITY_TOKEN = "token-1";

    let rejectFirst!: (error: Error) => void;
    const firstRequest = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    const extension = await loadInstalledExtension();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    extension.default({
      on(event, handler) {
        handlers.set(event, handler);
      },
    });

    handlers.get("agent_start")?.();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const drained = handlers.get("session_shutdown")?.();
    rejectFirst(new Error("offline"));
    await drained;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const states = fetchMock.mock.calls.map(([, init]) => {
      return JSON.parse(String((init as RequestInit).body)).state;
    });
    expect(states).toEqual(["running", "idle"]);
  });

  it("does not register duplicate reporters in inherited Pi child processes", async () => {
    process.env.BYSPACE_PI_TERMINAL_HOOK_OWNER_PID = "parent-pid";
    const extension = await loadInstalledExtension();
    const on = vi.fn();

    extension.default({ on });

    expect(on).not.toHaveBeenCalled();
  });
});
