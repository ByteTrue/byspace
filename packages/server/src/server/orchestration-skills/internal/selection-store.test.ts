import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonConfigStore, type MutableDaemonConfigPatch } from "../../daemon-config-store";
import { loadPersistedConfig } from "../../persisted-config";
import { createSkillSelectionStore } from "./selection-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), "byspace-agent-skills-config-"));
  roots.push(root);
  const config = new DaemonConfigStore(root, {
    mcp: { injectIntoAgents: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  });
  return { config, root, store: createSkillSelectionStore(config) };
}

describe("daemon agent skill selection", () => {
  it("defaults missing selection to all without persisting it", async () => {
    const { root, store } = await createStore();
    expect(await store.get()).toEqual({ mode: "all" });
    expect(await store.isSet()).toBe(false);
    expect(loadPersistedConfig(root).agents?.skills).toBeUndefined();
  });

  it("persists a normalized custom selection under agents.skills.selection", async () => {
    const { root, store } = await createStore();
    await store.set({ mode: "custom", skills: ["byspace-loop", "byspace", "byspace"] });
    expect(loadPersistedConfig(root).agents?.skills?.selection).toEqual({
      mode: "custom",
      skills: ["byspace", "byspace-loop"],
    });
  });

  it("replaces a custom selection with all without retaining custom skill names", async () => {
    const { config, root, store } = await createStore();
    await store.set({ mode: "custom", skills: ["byspace"] });

    await store.set({ mode: "all" });

    expect(config.get().skills?.selection).toEqual({ mode: "all" });
    expect(loadPersistedConfig(root).agents?.skills?.selection).toEqual({ mode: "all" });
  });

  it("defaults missing targets to every managed home without persisting them", async () => {
    const { root, store } = await createStore();

    expect(await store.getTargets()).toEqual(["agents", "claude"]);
    expect(loadPersistedConfig(root).agents?.skills).toBeUndefined();
  });

  it("persists targets beside the selection under agents.skills.targets", async () => {
    const { config, root, store } = await createStore();

    await store.set({ mode: "custom", skills: ["byspace"] }, ["claude", "claude"]);

    expect(config.get().skills?.targets).toEqual(["claude"]);
    expect(loadPersistedConfig(root).agents?.skills).toEqual({
      selection: { mode: "custom", skills: ["byspace"] },
      targets: ["claude"],
    });
  });

  it("keeps the stored targets when only a selection is written", async () => {
    const { store } = await createStore();
    await store.set({ mode: "all" }, ["agents"]);

    await store.set({ mode: "custom", skills: ["byspace"] });

    expect(await store.getTargets()).toEqual(["agents"]);
  });

  it("drops target ids this daemon does not manage", async () => {
    const { store } = await createStore();

    await store.set({ mode: "all" }, ["codex", "claude"] as never);

    expect(await store.getTargets()).toEqual(["claude"]);
  });

  it("does not expose selection through the generic config patch path", async () => {
    const { config, root, store } = await createStore();

    config.patch({
      skills: { selection: { mode: "custom", skills: ["byspace"] } },
    } as MutableDaemonConfigPatch);

    expect(await store.isSet()).toBe(false);
    expect(loadPersistedConfig(root).agents?.skills).toBeUndefined();
  });
});
