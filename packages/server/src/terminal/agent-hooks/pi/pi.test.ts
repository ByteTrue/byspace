import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentHooksAreInstalled,
  installAgentHooks,
  uninstallAgentHooks,
} from "../agent-hook-installer.js";
import { PI_ASK_USER_TOOL_NAMES, PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE } from "./pi-extension.js";
import { piAgentHookProvider } from "./pi.js";

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

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

    uninstallAgentHooks(piAgentHookProvider, options);

    expect(existsSync(extensionPath)).toBe(false);
    expect(agentHooksAreInstalled(piAgentHookProvider, options)).toBe(false);
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

  it("maps Pi lifecycle events to terminal activity states", async () => {
    await expect(piAgentHookProvider.resolveActivity({ event: "agent_start" })).resolves.toBe(
      "running",
    );
    await expect(piAgentHookProvider.resolveActivity({ event: "needs_input" })).resolves.toBe(
      "needs-input",
    );
    await expect(piAgentHookProvider.resolveActivity({ event: "agent_settled" })).resolves.toBe(
      "idle",
    );
  });

  it("wires bounded status delivery and guards child processes", () => {
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain(
      "const reportQueue = createReportQueue(sendReport)",
    );
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain(
      "ownerPid && ownerPid !== String(process.pid)",
    );
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain('pi.on("agent_settled"');
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain("isAskUserTool(event.toolName)");
    expect(PI_ASK_USER_TOOL_NAMES).toContain("ask_user");
    for (const toolName of PI_ASK_USER_TOOL_NAMES) {
      expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain(`"${toolName}"`);
    }
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain(
      'pi.on("session_shutdown", () => report("idle"))',
    );
  });

  it("preserves lifecycle order across failures while coalescing stale states", async () => {
    interface QueuedReport {
      url: string;
      terminalId: string;
      token: string;
      state: string;
    }
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(
      PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE,
    ).toString("base64")}`;
    const { createReportQueue } = (await import(moduleUrl)) as {
      createReportQueue: (sendReport: (report: QueuedReport) => Promise<void>) => {
        enqueue: (report: QueuedReport) => Promise<void>;
        wait: () => Promise<void>;
      };
    };
    const report = (state: string): QueuedReport => ({
      url: "http://127.0.0.1/activity",
      terminalId: "terminal-1",
      token: "token-1",
      state,
    });
    const secondRequest = createDeferred();
    const secondRequestStarted = createDeferred();
    const shutdownRequest = createDeferred();
    const shutdownRequestStarted = createDeferred();
    const reportedStates: string[] = [];
    let requestCount = 0;
    const queue = createReportQueue((next) => {
      requestCount += 1;
      reportedStates.push(next.state);
      if (requestCount === 1) throw new Error("synchronous request failure");
      if (requestCount === 2) {
        secondRequestStarted.resolve();
        return secondRequest.promise;
      }
      if (requestCount === 3) {
        shutdownRequestStarted.resolve();
        return shutdownRequest.promise;
      }
      return Promise.resolve();
    });

    await queue.enqueue(report("running"));

    const secondDrain = queue.enqueue(report("needs-input"));
    await secondRequestStarted.promise;
    void queue.enqueue(report("running"));
    const shutdownDrain = queue.enqueue(report("idle"));
    expect(shutdownDrain).toBe(secondDrain);

    secondRequest.reject(new Error("asynchronous request failure"));
    await shutdownRequestStarted.promise;
    const shutdownState = await Promise.race([
      shutdownDrain.then(() => "settled" as const),
      Promise.resolve("pending" as const),
    ]);
    expect(shutdownState).toBe("pending");

    shutdownRequest.resolve();
    await expect(shutdownDrain).resolves.toBeUndefined();
    expect(reportedStates).toEqual(["running", "needs-input", "idle"]);
    await expect(queue.wait()).resolves.toBeUndefined();
  });
});
