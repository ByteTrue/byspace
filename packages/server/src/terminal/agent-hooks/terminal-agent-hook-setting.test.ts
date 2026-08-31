import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { TerminalAgentHookSettings } from "@getpaseo/protocol/messages";
import { DaemonConfigStore } from "../../server/daemon-config-store.js";
import { agentHooksAreInstalled } from "./agent-hook-installer.js";
import { AGENT_HOOK_PROVIDERS } from "./provider-registry.js";
import {
  applyTerminalAgentHookSetting,
  resolveTerminalAgentHookSettings,
} from "./terminal-agent-hook-setting.js";

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

function createInstallEnv(root: string) {
  return {
    env: {
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
      OPENCODE_CONFIG_DIR: join(root, "opencode"),
      PI_CODING_AGENT_DIR: join(root, "pi"),
    },
    homeDir: join(root, "home"),
  };
}

function hookPaths(root: string) {
  return {
    claude: join(root, "claude", "settings.json"),
    codex: join(root, "codex", "hooks.json"),
    opencode: join(root, "opencode", "plugins", "paseo-terminal-activity.js"),
    pi: join(root, "pi", "extensions", "byspace-terminal-activity.ts"),
  };
}

function createStore(
  paseoHome: string,
  options: {
    legacyEnabled?: boolean;
    providers?: TerminalAgentHookSettings;
  } = {},
): DaemonConfigStore {
  return new DaemonConfigStore(
    paseoHome,
    {
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: options.legacyEnabled ?? false,
      ...(options.providers ? { terminalAgentHooks: options.providers } : {}),
      appendSystemPrompt: "",
    },
    undefined,
  );
}

describe("resolveTerminalAgentHookSettings", () => {
  it("uses the legacy global setting only when the provider map is absent", () => {
    expect(resolveTerminalAgentHookSettings({ enableTerminalAgentHooks: true })).toEqual({
      claude: true,
      codex: true,
      opencode: true,
      pi: true,
    });
  });

  it("treats every missing provider key as disabled", () => {
    expect(
      resolveTerminalAgentHookSettings({
        enableTerminalAgentHooks: true,
        terminalAgentHooks: { claude: true },
      }),
    ).toEqual({ claude: true, codex: false, opencode: false, pi: false });
  });
});

describe("applyTerminalAgentHookSetting", () => {
  it("leaves agent configs untouched when all provider settings are disabled", () => {
    const root = createTempDir("byspace-hook-setting-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), { providers: {} });

    applyTerminalAgentHookSetting({ store, install: createInstallEnv(root) });

    for (const path of Object.values(hookPaths(root))) {
      expect(existsSync(path)).toBe(false);
    }
  });

  it("keeps the legacy global setting working when no provider map exists", () => {
    const root = createTempDir("byspace-hook-setting-legacy-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), {
      legacyEnabled: true,
    });

    applyTerminalAgentHookSetting({ store, install: createInstallEnv(root) });

    for (const path of Object.values(hookPaths(root))) {
      expect(existsSync(path)).toBe(true);
    }
  });

  it("installs only explicitly enabled provider hooks", () => {
    const root = createTempDir("byspace-hook-setting-scoped-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), {
      providers: { claude: true, pi: true },
    });

    applyTerminalAgentHookSetting({ store, install: createInstallEnv(root) });

    const paths = hookPaths(root);
    expect(existsSync(paths.claude)).toBe(true);
    expect(existsSync(paths.pi)).toBe(true);
    expect(existsSync(paths.codex)).toBe(false);
    expect(existsSync(paths.opencode)).toBe(false);
  });

  it("reconciles one provider without changing the others", () => {
    const root = createTempDir("byspace-hook-setting-live-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), { providers: {} });
    const paths = hookPaths(root);
    const install = createInstallEnv(root);

    applyTerminalAgentHookSetting({ store, install });
    store.patch({ terminalAgentHooks: { claude: true } });
    expect(existsSync(paths.claude)).toBe(true);
    expect(existsSync(paths.pi)).toBe(false);

    store.patch({ terminalAgentHooks: { pi: true } });
    expect(existsSync(paths.claude)).toBe(true);
    expect(existsSync(paths.pi)).toBe(true);

    store.patch({ terminalAgentHooks: { claude: false } });
    expect(agentHooksAreInstalled(AGENT_HOOK_PROVIDERS.claude, install)).toBe(false);
    expect(agentHooksAreInstalled(AGENT_HOOK_PROVIDERS.pi, install)).toBe(true);

    store.patch({ enableTerminalAgentHooks: false });
    for (const provider of Object.values(AGENT_HOOK_PROVIDERS)) {
      expect(agentHooksAreInstalled(provider, install)).toBe(false);
    }
  });
});
