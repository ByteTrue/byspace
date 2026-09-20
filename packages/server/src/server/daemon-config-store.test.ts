import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DaemonConfigStore,
  applyMutableProviderConfigToOverrides,
  type DaemonNetworkControls,
} from "./daemon-config-store.js";
import { hashDaemonPassword } from "./auth.js";
import { loadPersistedConfig } from "./persisted-config.js";
import type { PersistedConfig } from "./persisted-config.js";
import type { MutableDaemonConfig } from "@bytetrue/protocol/messages";

function reloadableConfig(
  persisted: PersistedConfig,
  options: { relayEnabledFallback?: boolean } = {},
): MutableDaemonConfig {
  const daemon = persisted.daemon ?? {};
  const relay = daemon.relay ?? {};
  const git = daemon.git ?? {};
  const agents = persisted.agents ?? {};
  return {
    relay: {
      enabled: relay.enabled ?? options.relayEnabledFallback ?? true,
    },
    mcp: { enabled: true, injectIntoAgents: false },
    providers: (agents.providers ?? {}) as MutableDaemonConfig["providers"],
    metadataGeneration: { providers: agents.metadataGeneration?.providers ?? [] },
    autoArchiveAfterMerge: daemon.autoArchiveAfterMerge ?? false,
    enableTerminalAgentHooks: daemon.enableTerminalAgentHooks ?? false,
    appendSystemPrompt: daemon.appendSystemPrompt ?? "",
    terminalProfiles: daemon.terminalProfiles,
    agentProfiles: daemon.agentProfiles,
    cors: { allowedOrigins: [] },
    trustedProxies: ["loopback"],
    git: {
      maxProcessesPerSecond: git.maxProcessesPerSecond ?? 64,
      maxProcessConcurrency: git.maxProcessConcurrency ?? 8,
    },
    app: { baseUrl: "https://app.byspace.cc.cd" },
    pluginsEnabled: persisted.pluginsEnabled ?? false,
    plugins: persisted.plugins ?? {},
  };
}

describe("applyMutableProviderConfigToOverrides", () => {
  test("merges mutable provider fields onto provider overrides", () => {
    expect(
      applyMutableProviderConfigToOverrides(
        {
          gemini: {
            extends: "acp",
            label: "Gemini",
            command: ["gemini", "--acp"],
          },
        },
        {
          gemini: {
            enabled: false,
            description: "Gemini ACP",
            env: { GEMINI_AUTO_UPDATE: "0" },
          },
          claude: {
            additionalModels: [
              {
                id: "claude-custom",
                label: "claude-custom",
              },
            ],
          },
        },
      ),
    ).toEqual({
      gemini: {
        extends: "acp",
        label: "Gemini",
        description: "Gemini ACP",
        command: ["gemini", "--acp"],
        env: { GEMINI_AUTO_UPDATE: "0" },
        enabled: false,
      },
      claude: {
        additionalModels: [
          {
            id: "claude-custom",
            label: "claude-custom",
          },
        ],
      },
    });
  });
});

describe("DaemonConfigStore", () => {
  const tempDirs: string[] = [];
  // bcrypt cost 12 is slow; a single fixture hash shared by config-file tests.
  const HASH_FIXTURE = hashDaemonPassword("fixture");

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createStore(
    byspaceHome: string,
    options: {
      initial?: Partial<MutableDaemonConfig>;
      networkControls?: DaemonNetworkControls;
    } = {},
  ): DaemonConfigStore {
    return new DaemonConfigStore(
      byspaceHome,
      {
        relay: { enabled: false },
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        network: { allowLanAccess: false, tcpPort: 6777 },
        auth: { passwordSet: false },
        ...options.initial,
      },
      undefined,
      { networkControls: options.networkControls },
    );
  }

  const loopbackControls = (): DaemonNetworkControls => ({
    getTcpPort: () => 6777,
    isListenOverridden: () => false,
    isPasswordOverridden: () => false,
  });

  test("patch persists relay state and emits its field change", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = new DaemonConfigStore(byspaceHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });
    const changes: unknown[] = [];
    store.onFieldChange("relay.enabled", (value) => changes.push(value));

    store.patch({ relay: { enabled: true } });

    expect(changes).toEqual([true]);
    expect(loadPersistedConfig(byspaceHome).daemon?.relay?.enabled).toBe(true);
  });

  test("patch sets terminalDefaultShell and a null patch clears it back to auto", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = new DaemonConfigStore(byspaceHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });

    store.patch({ terminalDefaultShell: "/opt/homebrew/bin/fish" });
    expect(store.get().terminalDefaultShell).toBe("/opt/homebrew/bin/fish");
    expect(loadPersistedConfig(byspaceHome).daemon?.terminalDefaultShell).toBe(
      "/opt/homebrew/bin/fish",
    );

    store.patch({ terminalDefaultShell: null });
    expect(store.get().terminalDefaultShell ?? null).toBeNull();
    expect(loadPersistedConfig(byspaceHome).daemon?.terminalDefaultShell ?? null).toBeNull();
  });

  test("patch round-trips agent profiles through the strictly-parsed persisted config", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = new DaemonConfigStore(byspaceHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });

    store.patch({
      agentProfiles: [
        {
          id: "profile_ui",
          name: "UI work",
          icon: "🎨",
          provider: "claude",
          model: "claude-opus-5",
          modeId: "plan",
          thinkingOptionId: "think-hard",
          featureValues: { webSearch: true },
          notes: "Use for components, layout and design tokens.",
        },
      ],
    });

    expect(loadPersistedConfig(byspaceHome).daemon?.agentProfiles).toEqual([
      {
        id: "profile_ui",
        name: "UI work",
        icon: "🎨",
        provider: "claude",
        model: "claude-opus-5",
        modeId: "plan",
        thinkingOptionId: "think-hard",
        featureValues: { webSearch: true },
        notes: "Use for components, layout and design tokens.",
      },
    ]);
    expect(store.get().agentProfiles).toHaveLength(1);
  });

  test("patch replaces the whole agent profile list rather than merging entries", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = new DaemonConfigStore(byspaceHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
      agentProfiles: [
        { id: "a", name: "Keep", provider: "claude" },
        { id: "b", name: "Drop", provider: "codex" },
      ],
    });

    store.patch({ agentProfiles: [{ id: "a", name: "Keep", provider: "claude" }] });

    expect(store.get().agentProfiles).toEqual([{ id: "a", name: "Keep", provider: "claude" }]);
    expect(loadPersistedConfig(byspaceHome).daemon?.agentProfiles).toHaveLength(1);
  });

  test("rolls back config when a field transition fails", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = new DaemonConfigStore(byspaceHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });
    store.onFieldChange("relay.enabled", (enabled) => {
      if (enabled === true) {
        throw new Error("Relay transport failed to start");
      }
    });

    expect(() => store.patch({ relay: { enabled: true } })).toThrow(
      "Relay transport failed to start",
    );
    expect(store.get().relay?.enabled).toBe(false);
    expect(loadPersistedConfig(byspaceHome).daemon?.relay?.enabled).toBe(false);
  });

  test("rolls back live owners when a later transactional owner fails", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = new DaemonConfigStore(byspaceHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });
    let archivedAfterApply = false;
    store.onApply((next, previous) => {
      archivedAfterApply = next.autoArchiveAfterMerge;
      return () => {
        archivedAfterApply = previous.autoArchiveAfterMerge;
      };
    });
    store.onApply(() => {
      throw new Error("Provider refresh failed");
    });

    expect(() => store.patch({ autoArchiveAfterMerge: true })).toThrow("Provider refresh failed");
    expect(archivedAfterApply).toBe(false);
    expect(store.get().autoArchiveAfterMerge).toBe(false);
    expect(loadPersistedConfig(byspaceHome).daemon?.autoArchiveAfterMerge).toBeUndefined();
  });

  test("rejects relay patches when a launch override owns the setting", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = new DaemonConfigStore(
      byspaceHome,
      {
        relay: { enabled: false },
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
      { relayEnabledMutable: false },
    );

    expect(() => store.patch({ relay: { enabled: true } })).toThrow(
      "Relay is controlled by a daemon launch override",
    );
  });

  test("unrelated patches do not persist a one-launch relay override", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const persisted = loadPersistedConfig(byspaceHome);
    writeFileSync(
      path.join(byspaceHome, "config.json"),
      `${JSON.stringify({
        ...persisted,
        daemon: { ...persisted.daemon, relay: { enabled: false } },
      })}\n`,
    );
    const store = new DaemonConfigStore(
      byspaceHome,
      {
        relay: { enabled: true },
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
      { relayEnabledMutable: false },
    );

    store.patch({ autoArchiveAfterMerge: true });

    expect(loadPersistedConfig(byspaceHome).daemon?.relay?.enabled).toBe(false);
  });

  test("unrelated patches persist only requested file intent", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const before = loadPersistedConfig(byspaceHome);
    const store = new DaemonConfigStore(
      byspaceHome,
      {
        relay: { enabled: true },
        mcp: { enabled: false, injectIntoAgents: false },
        hostnames: ["launch.example.test"],
        cors: { allowedOrigins: ["https://launch.example.test"] },
        trustedProxies: true,
        git: { maxProcessesPerSecond: 7, maxProcessConcurrency: 2 },
        app: { baseUrl: "https://launch.example.test" },
        catalogRefreshTimeoutMs: 9_000,
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
      { relayEnabledMutable: false },
    );

    store.patch({
      appendSystemPrompt: "Only this field",
      // Reload-only runtime state is accepted as unknown wire data for forward
      // compatibility but is not part of the patch capability.
      hostnames: ["attempted-patch.example.test"],
    } as Parameters<typeof store.patch>[0]);

    expect(store.get().hostnames).toEqual(["launch.example.test"]);
    expect(loadPersistedConfig(byspaceHome)).toEqual({
      ...before,
      daemon: { ...before.daemon, appendSystemPrompt: "Only this field" },
    });
  });

  test("patch persists provider enabled flags into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const initial = loadPersistedConfig(byspaceHome);
    const configPath = path.join(byspaceHome, "config.json");
    // Reuse the validated serializer through the store path by seeding the file directly.
    // This keeps the test focused on the merge behavior.
    const seeded =
      JSON.stringify(
        {
          ...initial,
          agents: {
            providers: {
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
            },
          },
        },
        null,
        2,
      ) + "\n";
    writeFileSync(configPath, seeded);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      providers: {
        gemini: { enabled: false },
      },
    });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.providers?.gemini).toEqual({
      extends: "acp",
      label: "Gemini",
      command: ["gemini", "--acp"],
      enabled: false,
    });
  });

  test("patch persists provider BySpace-tool policy without changing availability", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    writeFileSync(
      path.join(byspaceHome, "config.json"),
      JSON.stringify({ agents: { providers: { claude: { enabled: false } } } }),
    );
    const store = new DaemonConfigStore(byspaceHome, {
      mcp: { injectIntoAgents: true },
      providers: { claude: { enabled: false } },
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });

    store.patch({
      providers: {
        claude: {
          byspaceTools: { enabled: true, disabledTools: ["list_agents"] },
        },
      },
    });
    store.patch({
      providers: {
        claude: {
          byspaceTools: { disabledTools: ["create_agent"] },
        },
      },
    });

    expect(store.get().providers.claude).toEqual({
      enabled: false,
      byspaceTools: { enabled: true, disabledTools: ["create_agent"] },
    });
    expect(loadPersistedConfig(byspaceHome).agents?.providers?.claude).toEqual({
      enabled: false,
      byspaceTools: { enabled: true, disabledTools: ["create_agent"] },
    });
  });

  test("patch removes provider entries from config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const configPath = path.join(byspaceHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            providers: {
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
              claude: {
                enabled: false,
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {
          gemini: {},
          claude: { enabled: false },
        },
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    const next = store.patch({ removeProviders: ["gemini"] });

    expect(next.providers.gemini).toBeUndefined();
    expect(next.providers.claude).toEqual({ enabled: false });
    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.providers?.gemini).toBeUndefined();
    expect(persisted.agents?.providers?.claude).toEqual({ enabled: false });
  });

  test("patch removes the providers object when the last provider is deleted", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const configPath = path.join(byspaceHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            providers: {
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: { gemini: {} },
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({ removeProviders: ["gemini"] });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.providers).toBeUndefined();
  });

  test("patch removes deleted providers from metadata generation", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const configPath = path.join(byspaceHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            providers: {
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
              claude: {
                enabled: false,
              },
            },
            metadataGeneration: {
              providers: [
                { provider: "gemini", model: "flash" },
                { provider: "claude", model: "haiku" },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {
          gemini: {},
          claude: { enabled: false },
        },
        metadataGeneration: {
          providers: [
            { provider: "gemini", model: "flash" },
            { provider: "claude", model: "haiku" },
          ],
        },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    const next = store.patch({ removeProviders: ["gemini"] });

    expect(next.metadataGeneration.providers).toEqual([{ provider: "claude", model: "haiku" }]);
    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.metadataGeneration).toEqual({
      providers: [{ provider: "claude", model: "haiku" }],
    });
  });

  test("patch persists provider removal when in-memory config is already clean", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const configPath = path.join(byspaceHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            providers: {
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
            },
            metadataGeneration: {
              providers: [{ provider: "gemini", model: "flash" }],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    const next = store.patch({ removeProviders: ["gemini"] });

    expect(next.providers.gemini).toBeUndefined();
    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.providers).toBeUndefined();
    expect(persisted.agents?.metadataGeneration).toEqual({ providers: [] });
  });

  test("patch persists append system prompt into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      appendSystemPrompt: "Prefer terse replies.",
    });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.daemon?.appendSystemPrompt).toBe("Prefer terse replies.");
  });

  test("patch persists provider additional models into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      providers: {
        claude: {
          additionalModels: [
            {
              id: "claude-custom",
              label: "claude-custom",
            },
          ],
        },
      },
    });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.providers?.claude).toEqual({
      additionalModels: [
        {
          id: "claude-custom",
          label: "claude-custom",
        },
      ],
    });
  });

  test("patch persists daemon append system prompt into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      appendSystemPrompt: "Prefer terse replies.",
    });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.daemon?.appendSystemPrompt).toBe("Prefer terse replies.");
  });

  test("an explicit legacy patch applies only to historical terminal hook providers", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({ enableTerminalAgentHooks: true });

    const expected = { claude: true, codex: true, opencode: true, pi: false };
    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.daemon?.enableTerminalAgentHooks).toBe(true);
    expect(persisted.daemon?.terminalAgentHooks).toEqual(expected);
    expect(store.get().terminalAgentHooks).toEqual(expected);
  });

  test("patch merges provider terminal agent hooks into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        terminalAgentHooks: {},
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({ terminalAgentHooks: { claude: true } });
    store.patch({ terminalAgentHooks: { pi: true } });

    const expected = { claude: true, codex: false, opencode: false, pi: true };
    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.daemon?.terminalAgentHooks).toEqual(expected);
    expect(persisted.daemon?.enableTerminalAgentHooks).toBe(true);
    expect(store.get().terminalAgentHooks).toEqual(expected);
    expect(store.get().enableTerminalAgentHooks).toBe(true);
  });

  test("keeps legacy aggregate patches bidirectionally compatible", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-legacy-hooks-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: true,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({ terminalAgentHooks: { pi: true, future: true } });
    expect(store.get().terminalAgentHooks).toEqual({
      claude: true,
      codex: true,
      opencode: true,
      pi: true,
      future: true,
    });
    expect(store.get().enableTerminalAgentHooks).toBe(true);

    store.patch({ enableTerminalAgentHooks: false });
    const expected = {
      claude: false,
      codex: false,
      opencode: false,
      pi: true,
      future: true,
    };
    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.daemon?.terminalAgentHooks).toEqual(expected);
    expect(persisted.daemon?.enableTerminalAgentHooks).toBe(true);
    expect(store.get().terminalAgentHooks).toEqual(expected);
    expect(store.get().enableTerminalAgentHooks).toBe(true);
  });

  test("patch persists metadata generation providers into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      metadataGeneration: {
        providers: [
          { provider: "claude", model: "haiku" },
          { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
        ],
      },
    });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.metadataGeneration).toEqual({
      providers: [
        { provider: "claude", model: "haiku" },
        { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
      ],
    });
  });

  test("patch persists clearing metadata generation providers into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const configPath = path.join(byspaceHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            metadataGeneration: {
              providers: [{ provider: "claude", model: "haiku" }],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [{ provider: "claude", model: "haiku" }] },
      },
      undefined,
    );

    store.patch({ metadataGeneration: { providers: [] } });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.metadataGeneration).toEqual({ providers: [] });
  });

  test("patch persists custom ACP provider overrides into config.json", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);

    const store = new DaemonConfigStore(
      byspaceHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [] },
      },
      undefined,
    );

    store.patch({
      providers: {
        "byspace-e2e-acp": {
          extends: "acp",
          label: "BySpace E2E ACP",
          description: "E2E ACP provider fixture",
          command: ["npx", "-y", "--version"],
          env: {},
        },
      },
    });

    const persisted = loadPersistedConfig(byspaceHome);
    expect(persisted.agents?.providers?.["byspace-e2e-acp"]).toEqual({
      extends: "acp",
      label: "BySpace E2E ACP",
      description: "E2E ACP provider fixture",
      command: ["npx", "-y", "--version"],
      env: {},
    });
  });
  test("password patch hashes into persisted auth and exposes only passwordSet", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });

    store.patch({ auth: { password: "lan-secret" } });

    expect(store.get().auth?.passwordSet).toBe(true);
    expect(store.get().auth).not.toHaveProperty("password");
    const persistedAuth = loadPersistedConfig(byspaceHome).daemon?.auth?.password;
    expect(persistedAuth).toBeDefined();
    expect(persistedAuth).not.toBe("lan-secret");
    expect(persistedAuth).toMatch(/^\$2[aby]\$/);
  });

  test("null password patch clears persisted auth", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });
    store.patch({ auth: { password: "lan-secret" } });

    store.patch({ auth: { password: null } });

    expect(store.get().auth?.passwordSet).toBe(false);
    expect(loadPersistedConfig(byspaceHome).daemon?.auth).toBeUndefined();
  });

  test("allowLanAccess patch rewrites persisted listen preserving the bound port", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });
    store.patch({ auth: { password: "lan-secret" } });

    store.patch({ network: { allowLanAccess: true } });

    expect(store.get().network?.allowLanAccess).toBe(true);
    expect(store.get().network?.tcpPort).toBe(6777);
    expect(loadPersistedConfig(byspaceHome).daemon?.listen).toBe("0.0.0.0:6777");

    store.patch({ network: { allowLanAccess: false } });
    expect(store.get().network?.allowLanAccess).toBe(false);
    expect(loadPersistedConfig(byspaceHome).daemon?.listen).toBe("127.0.0.1:6777");
  });

  test("allowLanAccess is rejected while no password is configured", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });

    expect(() => store.patch({ network: { allowLanAccess: true } })).toThrow(
      /Set a daemon password before allowing LAN access/,
    );
    expect(store.get().network?.allowLanAccess).toBe(false);
  });

  test("clearing the password is rejected while LAN access stays enabled", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });
    store.patch({ auth: { password: "lan-secret" } });
    store.patch({ network: { allowLanAccess: true } });

    expect(() => store.patch({ auth: { password: null } })).toThrow(
      /Disable LAN access before removing the daemon password/,
    );
    expect(store.get().auth?.passwordSet).toBe(true);
    expect(loadPersistedConfig(byspaceHome).daemon?.auth?.password).toBeDefined();
  });

  test("a patch may set the password and enable LAN access atomically", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });

    store.patch({ auth: { password: "lan-secret" }, network: { allowLanAccess: true } });

    expect(store.get().auth?.passwordSet).toBe(true);
    expect(store.get().network?.allowLanAccess).toBe(true);
    expect(loadPersistedConfig(byspaceHome).daemon?.listen).toBe("0.0.0.0:6777");
    expect(loadPersistedConfig(byspaceHome).daemon?.auth?.password).toMatch(/^\$2[aby]\$/);
  });

  test("allowLanAccess is rejected when the daemon does not listen on TCP", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, {
      initial: { network: { allowLanAccess: false, tcpPort: null }, auth: { passwordSet: true } },
      networkControls: { ...loopbackControls(), getTcpPort: () => null },
    });

    expect(() => store.patch({ network: { allowLanAccess: true } })).toThrow(
      /requires a TCP listener/,
    );
  });

  test("clearing the password is rejected when the persisted listen is LAN-open even if the view is loopback", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    writeFileSync(
      path.join(byspaceHome, "config.json"),
      JSON.stringify({ daemon: { listen: "0.0.0.0:6777", auth: { password: HASH_FIXTURE } } }),
    );
    // A launch override forced this run onto loopback, hiding the open listener
    // from the view. The invariant must still consult the persisted value.
    const store = createStore(byspaceHome, {
      initial: { network: { allowLanAccess: false, tcpPort: 6777 }, auth: { passwordSet: true } },
      networkControls: {
        ...loopbackControls(),
        isListenOverridden: () => true,
      },
    });

    expect(() => store.patch({ auth: { password: null } })).toThrow(
      /Disable LAN access before removing the daemon password/,
    );
    expect(loadPersistedConfig(byspaceHome).daemon?.auth?.password).toBe(HASH_FIXTURE);
  });

  test("a network patch on a socket daemon leaves the persisted listen untouched", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    writeFileSync(
      path.join(byspaceHome, "config.json"),
      JSON.stringify({ daemon: { listen: "/tmp/byspace.sock", auth: { password: HASH_FIXTURE } } }),
    );
    const store = createStore(byspaceHome, {
      initial: { network: { allowLanAccess: false, tcpPort: null }, auth: { passwordSet: true } },
      networkControls: { ...loopbackControls(), getTcpPort: () => null },
    });

    store.patch({ network: { allowLanAccess: false } });

    expect(loadPersistedConfig(byspaceHome).daemon?.listen).toBe("/tmp/byspace.sock");
    expect(store.get().network?.allowLanAccess).toBe(false);
  });

  test("network and password patches are rejected under launch overrides", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, {
      networkControls: {
        ...loopbackControls(),
        isListenOverridden: () => true,
        isPasswordOverridden: () => true,
      },
    });

    expect(() => store.patch({ network: { allowLanAccess: true } })).toThrow(
      /controlled by BYSPACE_LISTEN/,
    );
    expect(() => store.patch({ auth: { password: "x" } })).toThrow(
      /controlled by the BYSPACE_PASSWORD environment variable/,
    );
  });

  test("re-setting the password persists a new hash even when the view is unchanged", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });
    store.patch({ auth: { password: "first-secret" } });
    const firstHash = loadPersistedConfig(byspaceHome).daemon?.auth?.password;

    store.patch({ auth: { password: "second-secret" } });

    const secondHash = loadPersistedConfig(byspaceHome).daemon?.auth?.password;
    expect(secondHash).toBeDefined();
    expect(secondHash).not.toBe(firstHash);
  });

  test("refreshNetworkRuntimeState updates the view without persisting", () => {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-store-"));
    tempDirs.push(byspaceHome);
    const store = createStore(byspaceHome, { networkControls: loopbackControls() });
    const before = loadPersistedConfig(byspaceHome);

    store.refreshNetworkRuntimeState({ tcpPort: 61234, allowLanAccess: false });

    expect(store.get().network?.tcpPort).toBe(61234);
    expect(loadPersistedConfig(byspaceHome)).toEqual(before);
  });
});

describe("DaemonConfigStore reload", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function createReloadableStore(
    options: {
      overrideControlledPaths?: string[];
      initialPersisted?: PersistedConfig;
    } = {},
  ) {
    const byspaceHome = mkdtempSync(path.join(tmpdir(), "byspace-daemon-config-reload-"));
    tempDirs.push(byspaceHome);
    if (options.initialPersisted) {
      writeFileSync(
        path.join(byspaceHome, "config.json"),
        `${JSON.stringify(options.initialPersisted, null, 2)}\n`,
      );
    }
    const persisted = loadPersistedConfig(byspaceHome);
    const relayEnabledFallback = persisted.daemon?.relay?.enabled === undefined;
    const initialMutable = reloadableConfig(persisted, { relayEnabledFallback });
    const store = new DaemonConfigStore(byspaceHome, initialMutable, undefined, {
      reloadSource: {
        resolve: (nextPersisted) => {
          const mutable = reloadableConfig(nextPersisted, { relayEnabledFallback });
          if (options.overrideControlledPaths?.includes("daemon.relay.enabled")) {
            mutable.relay = initialMutable.relay;
          }
          return {
            mutable,
            overrideControlledPaths: options.overrideControlledPaths ?? [],
          };
        },
      },
    });
    return { byspaceHome, store, persisted };
  }

  function writeConfig(byspaceHome: string, config: unknown): void {
    writeFileSync(path.join(byspaceHome, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  }

  test("applies mutable edits and reports startup-only edits", () => {
    const { byspaceHome, store, persisted } = createReloadableStore();
    writeConfig(byspaceHome, {
      ...persisted,
      daemon: {
        ...persisted.daemon,
        listen: "127.0.0.1:7777",
        appendSystemPrompt: "Be terse.",
        git: { maxProcessesPerSecond: 12, maxProcessConcurrency: 3 },
      },
    });

    expect(store.reload()).toEqual({
      appliedPaths: [
        "daemon.appendSystemPrompt",
        "daemon.git.maxProcessConcurrency",
        "daemon.git.maxProcessesPerSecond",
      ],
      restartRequiredPaths: ["daemon.listen"],
      overrideControlledPaths: [],
    });
    expect(store.get().appendSystemPrompt).toBe("Be terse.");
    expect(store.get().git).toEqual({ maxProcessesPerSecond: 12, maxProcessConcurrency: 3 });
  });

  test("applies the global plugin switch in both directions", () => {
    const { byspaceHome, store, persisted } = createReloadableStore({
      initialPersisted: { version: 1, pluginsEnabled: false },
    });
    const changes: unknown[] = [];
    store.onFieldChange("pluginsEnabled", (value) => changes.push(value));

    writeConfig(byspaceHome, { ...persisted, pluginsEnabled: true });
    expect(store.reload()).toEqual({
      appliedPaths: ["pluginsEnabled"],
      restartRequiredPaths: [],
      overrideControlledPaths: [],
    });
    expect(store.get().pluginsEnabled).toBe(true);

    writeConfig(byspaceHome, { ...persisted, pluginsEnabled: false });
    expect(store.reload()).toEqual({
      appliedPaths: ["pluginsEnabled"],
      restartRequiredPaths: [],
      overrideControlledPaths: [],
    });
    expect(store.get().pluginsEnabled).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  test("classifies every leaf when a parent subtree is added", () => {
    const { byspaceHome, store } = createReloadableStore({
      initialPersisted: { version: 1 },
    });
    writeConfig(byspaceHome, {
      version: 1,
      daemon: {
        relay: {
          enabled: false,
          endpoint: "relay.example.test:443",
          useTls: true,
        },
      },
    });

    expect(store.reload()).toEqual({
      appliedPaths: ["daemon.relay.enabled"],
      restartRequiredPaths: ["daemon.relay.endpoint", "daemon.relay.useTls"],
      overrideControlledPaths: [],
    });
  });

  test("classifies every leaf when the daemon subtree is removed", () => {
    const { byspaceHome, store } = createReloadableStore({
      initialPersisted: {
        version: 1,
        daemon: {
          listen: "127.0.0.1:7777",
          appendSystemPrompt: "Be terse.",
          relay: {
            enabled: false,
            endpoint: "relay.example.test:443",
            useTls: true,
          },
          serviceProxy: {
            listen: "127.0.0.1:7788",
            publicBaseUrl: "https://services.example.test",
          },
        },
      },
    });
    writeConfig(byspaceHome, { version: 1 });

    expect(store.reload()).toEqual({
      appliedPaths: ["daemon.appendSystemPrompt"],
      restartRequiredPaths: [
        "daemon.listen",
        "daemon.relay.endpoint",
        "daemon.relay.useTls",
        "daemon.serviceProxy.listen",
        "daemon.serviceProxy.publicBaseUrl",
      ],
      overrideControlledPaths: [],
    });
    expect(store.get().relay?.enabled).toBe(false);
  });

  test("keeps overridden leaves separate from restart-required siblings", () => {
    const { byspaceHome, store } = createReloadableStore({
      initialPersisted: { version: 1 },
      overrideControlledPaths: ["daemon.relay.enabled"],
    });
    writeConfig(byspaceHome, {
      version: 1,
      daemon: {
        relay: { enabled: false, endpoint: "relay.example.test:443" },
      },
    });

    expect(store.reload()).toEqual({
      appliedPaths: [],
      restartRequiredPaths: ["daemon.relay.endpoint"],
      overrideControlledPaths: ["daemon.relay.enabled"],
    });
  });

  test("invalid JSON and invalid schema apply nothing", () => {
    const { byspaceHome, store } = createReloadableStore();
    writeFileSync(path.join(byspaceHome, "config.json"), "{ nope\n");
    expect(() => store.reload()).toThrow("Invalid JSON");
    expect(store.get().autoArchiveAfterMerge).toBe(false);

    writeConfig(byspaceHome, { daemon: { autoArchiveAfterMerge: "yes" } });
    expect(() => store.reload()).toThrow("Invalid config");
    expect(store.get().autoArchiveAfterMerge).toBe(false);
  });

  test("removing providers and optional profiles clears live state", () => {
    const { byspaceHome, store, persisted } = createReloadableStore();
    writeConfig(byspaceHome, {
      ...persisted,
      daemon: {
        ...persisted.daemon,
        terminalProfiles: [{ id: "shell", name: "Shell", command: "bash" }],
        agentProfiles: [{ id: "review", name: "Review", provider: "codex" }],
      },
      agents: {
        providers: {
          gemini: { extends: "acp", label: "Gemini", command: ["gemini", "--acp"] },
        },
      },
    });
    store.reload();

    writeConfig(byspaceHome, persisted);
    const result = store.reload();

    expect(result.appliedPaths).toEqual([
      "agents.providers",
      "daemon.agentProfiles",
      "daemon.terminalProfiles",
    ]);
    expect(store.get().providers).toEqual({});
    expect(store.get().terminalProfiles).toBeUndefined();
    expect(store.get().agentProfiles).toBeUndefined();
  });

  test("reports a launch-controlled edit without changing live state", () => {
    const { byspaceHome, store, persisted } = createReloadableStore({
      overrideControlledPaths: ["daemon.relay.enabled"],
    });
    const initialRelay = store.get().relay?.enabled;
    writeConfig(byspaceHome, {
      ...persisted,
      daemon: { ...persisted.daemon, relay: { enabled: !initialRelay } },
    });

    expect(store.reload()).toEqual({
      appliedPaths: [],
      restartRequiredPaths: [],
      overrideControlledPaths: ["daemon.relay.enabled"],
    });
    expect(store.get().relay?.enabled).toBe(initialRelay);
  });

  test("an unrelated patch does not mark a manual override-owned edit as applied", () => {
    const { byspaceHome, store, persisted } = createReloadableStore({
      overrideControlledPaths: ["daemon.relay.enabled"],
    });
    writeConfig(byspaceHome, {
      ...persisted,
      daemon: { ...persisted.daemon, relay: { enabled: true } },
    });
    store.patch({ appendSystemPrompt: "patched elsewhere" });

    expect(store.reload()).toEqual({
      appliedPaths: [],
      restartRequiredPaths: [],
      overrideControlledPaths: ["daemon.relay.enabled"],
    });
  });

  test("reports startup-only launch overrides instead of restart warnings", () => {
    const { byspaceHome, store, persisted } = createReloadableStore({
      overrideControlledPaths: ["daemon.listen", "daemon.relay.endpoint"],
    });
    writeConfig(byspaceHome, {
      ...persisted,
      daemon: {
        ...persisted.daemon,
        listen: "127.0.0.1:7777",
        relay: {
          ...persisted.daemon?.relay,
          endpoint: "relay.example.test:443",
        },
      },
    });

    expect(store.reload()).toEqual({
      appliedPaths: [],
      restartRequiredPaths: [],
      overrideControlledPaths: ["daemon.listen", "daemon.relay.endpoint"],
    });
  });

  test("a no-op reload returns empty path lists", () => {
    const { store } = createReloadableStore();
    expect(store.reload()).toEqual({
      appliedPaths: [],
      restartRequiredPaths: [],
      overrideControlledPaths: [],
    });
  });
});
