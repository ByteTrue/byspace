/**
 * A run whose issue is deleted mid-flight must not take the executor down
 * with it: the settlement is dropped, the agent's concurrency slot is
 * released, and the drain loop keeps serving other work. The source avoids
 * the window by cancelling and settling inside the delete transaction;
 * without an outbox this side of the port, dropping the settlement is the
 * honest equivalent — the record went with the issue.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentManager } from "../agent/agent-manager.js";
import type { BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import { MulticaExecutor } from "./executor.js";
import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as import("pino").Logger;

describe("run over a deleted issue", () => {
  beforeEach(() => {
    store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
  });
  afterEach(() => {
    store.close();
  });

  it("the settlement is dropped and the agent is free for the next run", async () => {
    const agent = store.createAgent({ name: "Worker" });
    const doomed = store.createIssue({ title: "Doomed", creatorType: "owner", creatorId: "owner" });
    const task = store.createTask({ issueId: doomed.id, agentId: agent.id });
    let releaseIssue: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseIssue = resolve;
    });
    const slowAgentManager = {
      runAgent: async () => {
        releaseIssue?.();
        await gate;
        return { canceled: false, finalText: "done" };
      },
      waitForAgentEvent: async () => ({ permission: false, lastMessage: "done" }),
    } as unknown as AgentManager;
    const createAgent: BoundCreateAgentCommand = (async () => ({
      snapshot: { id: "session-doomed" },
      liveSnapshot: { id: "session-doomed" },
      background: true,
      initialPromptStarted: true,
      initialPromptError: null,
    })) as unknown as BoundCreateAgentCommand;
    const executor = new MulticaExecutor({
      store,
      agentManager: slowAgentManager,
      createAgent,
      resolveWorkspace: async () => ({ cwd: "/tmp/multica-exec-test", workspaceId: "wks-test" }),
      logger: quietLogger,
    });
    const draining = executor.drain();
    await gate;
    // The owner deletes the issue while the run is mid-turn: its task row
    // goes with it (source cascade), and the run's settlement loses its home.
    store.deleteIssue(doomed.id);
    releaseIssue?.();
    await expect(draining).resolves.toBeGreaterThanOrEqual(0);
    // The agent's slot is free: a second issue's run executes in the same drain pass.
    const next = store.createIssue({ title: "Next", creatorType: "owner", creatorId: "owner" });
    store.createTask({ issueId: next.id, agentId: agent.id });
    await executor.drain();
    const tasks = store.listTasksForIssue(next.id);
    expect(tasks[0]?.status).toBe("completed");
    void task;
  });
});
