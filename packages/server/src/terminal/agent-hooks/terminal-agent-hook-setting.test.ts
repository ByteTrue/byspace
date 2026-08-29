import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { TerminalAgentHookSettings } from "./terminal-agent-hook-setting.js";
import { DaemonConfigStore } from "../../server/daemon-config-store.js";
import {
  applyTerminalAgentHookSetting,
  resolveTerminalAgentHookSettings,
} from "./terminal-agent-hook-setting.js";
import { agentHooksAreInstalled } from "./agent-hook-installer.js";
import {
  AGENT_HOOK_PROVIDERS,
  type AgentHookProviderId,
  installRegisteredAgentHook,
} from "./provider-registry.js";

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

function createStore(
  byspaceHome: string,
  enableTerminalAgentHooks: boolean,
  terminalAgentHooks?: Partial<TerminalAgentHookSettings>,
): DaemonConfigStore {
  return new DaemonConfigStore(
    byspaceHome,
    {
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks,
      terminalAgentHooks,
      appendSystemPrompt: "",
    },
    undefined,
  );
}

function expectInstalled(root: string, expected: Partial<TerminalAgentHookSettings>) {
  const install = createInstallEnv(root);
  for (const providerId of Object.keys(AGENT_HOOK_PROVIDERS) as AgentHookProviderId[]) {
    expect(agentHooksAreInstalled(AGENT_HOOK_PROVIDERS[providerId], install), providerId).toBe(
      expected[providerId] === true,
    );
  }
}

describe("resolveTerminalAgentHookSettings", () => {
  it("inherits the legacy global setting only for absent provider values", () => {
    expect(
      resolveTerminalAgentHookSettings({
        enableTerminalAgentHooks: true,
        terminalAgentHooks: { pi: false },
      }),
    ).toEqual({ claude: true, codex: true, opencode: true, pi: false });
  });
});

describe("applyTerminalAgentHookSetting", () => {
  it("leaves every agent config untouched when legacy hooks are disabled", () => {
    const root = createTempDir("byspace-hook-setting-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), false);

    applyTerminalAgentHookSetting({ store, install: createInstallEnv(root) });

    expectInstalled(root, {});
  });

  it("does not remove an existing hook merely because another daemon starts disabled", () => {
    const root = createTempDir("byspace-hook-setting-");
    const install = createInstallEnv(root);
    const store = createStore(createTempDir("byspace-hook-setting-home-"), false);
    installRegisteredAgentHook("pi", install);

    applyTerminalAgentHookSetting({ store, install });

    expectInstalled(root, { pi: true });
  });

  it("installs every provider, including Pi, for an enabled legacy setting", () => {
    const root = createTempDir("byspace-hook-setting-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), true);

    applyTerminalAgentHookSetting({ store, install: createInstallEnv(root) });

    expectInstalled(root, { claude: true, codex: true, opencode: true, pi: true });
  });

  it("changes one provider without mutating sibling hook files", () => {
    const root = createTempDir("byspace-hook-setting-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), false, { pi: true });

    applyTerminalAgentHookSetting({ store, install: createInstallEnv(root) });
    expectInstalled(root, { pi: true });

    store.patch({
      terminalAgentHooks: { claude: false, codex: true, opencode: false, pi: false },
      enableTerminalAgentHooks: true,
    });

    expectInstalled(root, { codex: true });
  });

  it("keeps an old client's global switch authoritative", () => {
    const root = createTempDir("byspace-hook-setting-");
    const store = createStore(createTempDir("byspace-hook-setting-home-"), false, { pi: true });

    applyTerminalAgentHookSetting({ store, install: createInstallEnv(root) });
    store.patch({ enableTerminalAgentHooks: true });
    expectInstalled(root, { claude: true, codex: true, opencode: true, pi: true });

    store.patch({ enableTerminalAgentHooks: false });
    expectInstalled(root, {});
  });
});
