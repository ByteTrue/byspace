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

  it("keeps status delivery fire-and-forget and guards inherited child processes", () => {
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain("@earendil-works/pi-coding-agent");
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain("void fetch(url, {");
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain(
      "ownerPid && ownerPid !== String(process.pid)",
    );
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain('pi.on("agent_settled"');
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain("isAskUserTool(event.toolName)");
    expect(PI_ASK_USER_TOOL_NAMES).toContain("ask_user");
    for (const toolName of PI_ASK_USER_TOOL_NAMES) {
      expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain(`"${toolName}"`);
    }
    expect(PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE).toContain('pi.on("session_shutdown"');
  });
});
