/**
 * The retry lineage: only a startup-phase failure spawns a child; the child
 * carries attempt+1 and points at its parent; the ceiling stops the line;
 * permission gates and cancellations never retry.
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

const managerThatSucceeds = {
  runAgent: async () => ({ canceled: false, finalText: "done" }),
  waitForAgentEvent: async () => ({ permission: false, lastMessage: "done" }),
} as unknown as AgentManager;

const managerThatWaitsForPermission = {
  runAgent: async () => ({ canceled: false, finalText: null }),
  waitForAgentEvent: async () => ({ permission: true, lastMessage: null }),
} as unknown as AgentManager;

const failingCreate: BoundCreateAgentCommand = (async () => {
  throw new Error("runtime never came up");
}) as unknown as BoundCreateAgentCommand;

const succeedingCreate: BoundCreateAgentCommand = (async () => ({
  snapshot: { id: "session-ok" },
  liveSnapshot: { id: "session-ok" },
  background: true,
  initialPromptStarted: true,
  initialPromptError: null,
})) as unknown as BoundCreateAgentCommand;

const executorFor = (createAgent: BoundCreateAgentCommand, agentManager: AgentManager) =>
  new MulticaExecutor({
    store,
    agentManager,
    createAgent,
    resolveWorkspace: async () => ({ cwd: "/tmp/multica-retry-test", workspaceId: "wks-test" }),
    resolveAutopilotWorkspace: async () => ({
      cwd: "/tmp/multica-retry-test",
      workspaceId: "wks-test",
    }),
    logger: quietLogger,
  });

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

describe("retry lineage", () => {
  it("a startup failure spawns exactly one child with attempt+1 and a parent pointer", async () => {
    const agent = store.createAgent({ name: "Worker" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    const task = store.createTask({ agentId: agent.id, issueId: issue.id });

    await executorFor(failingCreate, managerThatSucceeds).drain();

    const rows = store.listTasksForIssue(issue.id);
    expect(rows).toHaveLength(2);
    const child = rows.find((row) => row.id !== task.id);
    expect(child?.attempt).toBe(task.attempt + 1);
    expect(child?.retryOfTaskId).toBe(task.id);
    expect(child?.status).toBe("queued");
    expect(store.getTask(task.id).status).toBe("failed");
  });

  it("the ceiling stops the line: at max attempts the failure stands", async () => {
    const agent = store.createAgent({ name: "Worker" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    store.createTask({ agentId: agent.id, issueId: issue.id });

    // Default ceiling is 2: parent attempt 1 fails, child attempt 2 fails,
    // and a third must not appear.
    await executorFor(failingCreate, managerThatSucceeds).drain();
    await executorFor(failingCreate, managerThatSucceeds).drain();

    const rows = store.listTasksForIssue(issue.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "failed")).toBe(true);
  });

  it("a permission gate is a human's turn, not a retry", async () => {
    const agent = store.createAgent({ name: "Worker" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    store.createTask({ agentId: agent.id, issueId: issue.id });

    await executorFor(succeedingCreate, managerThatWaitsForPermission).drain();

    expect(store.listTasksForIssue(issue.id)).toHaveLength(1);
  });

  it("a successful startup that then succeeds writes no lineage", async () => {
    const agent = store.createAgent({ name: "Worker" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    store.createTask({ agentId: agent.id, issueId: issue.id });

    await executorFor(succeedingCreate, managerThatSucceeds).drain();

    const rows = store.listTasksForIssue(issue.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
  });
});
