/**
 * The agent's execution facts must reach the session it spawns: the model
 * override rides the create config and the custom env rows ride the env —
 * the source's daemon layers both into the child process, and our columns
 * were display-only dead weight until this landed.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentManager } from "../agent/agent-manager.js";
import type { BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import { agentEnvForRun, MulticaExecutor } from "./executor.js";
import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as import("pino").Logger;

describe("agent execution config", () => {
  beforeEach(() => {
    store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
  });
  afterEach(() => {
    store.close();
  });

  it("the model and custom env reach the session the run spawns", async () => {
    const agent = store.createAgent({ name: "Configured" });
    store.updateAgent(agent.id, { model: "qwen-max" });
    store.updateAgent(agent.id, { customEnv: { MULTICA_PROBE: "yes" } });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    store.createTask({ issueId: issue.id, agentId: agent.id });

    const seen: { config: unknown; env: unknown }[] = [];
    const createAgent: BoundCreateAgentCommand = (async (input) => {
      seen.push({ config: input.config, env: input.env });
      return {
        snapshot: { id: "agent-config-session" },
        liveSnapshot: { id: "agent-config-session" },
        background: true,
        initialPromptStarted: true,
        initialPromptError: null,
      };
    }) as unknown as BoundCreateAgentCommand;
    const agentManager = {
      runAgent: async () => ({ canceled: false, finalText: "done" }),
      waitForAgentEvent: async () => ({ permission: false, lastMessage: "done" }),
    } as unknown as AgentManager;

    await new MulticaExecutor({
      store,
      agentManager,
      createAgent,
      resolveWorkspace: async () => ({ cwd: "/tmp/multica-exec-test", workspaceId: "wks-test" }),
      logger: quietLogger,
    }).drain();

    expect(seen).toHaveLength(1);
    expect(seen[0].config).toEqual({ model: "qwen-max" });
    expect(seen[0].env).toEqual({ MULTICA_PROBE: "yes" });
  });

  it("a broken stored env throws at the boundary, not silently", () => {
    expect(() => agentEnvForRun("[not an object]")).toThrow(/custom_env/);
    expect(() => agentEnvForRun("{broken json")).toThrow(/custom_env/);
    expect(() => agentEnvForRun('{"NO_NUMBER": 1}')).toThrow(/not a string/);
    expect(agentEnvForRun("null")).toBeUndefined();
    expect(agentEnvForRun("")).toBeUndefined();
    expect(agentEnvForRun("{}")).toEqual({});
    expect(agentEnvForRun('{"A":"b"}')).toEqual({ A: "b" });
  });
});
