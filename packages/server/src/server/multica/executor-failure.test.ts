/**
 * The executor's failure surface: a failed run must land on the owner's desk
 * as an action_required inbox item, because a person — not the issue board —
 * is the one who needs to decide what happens next.
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

const failingAgentManager = {
  runAgent: async () => {
    throw new Error("provider refused the turn");
  },
  waitForAgentEvent: async () => ({ permission: false, lastMessage: null }),
} as unknown as AgentManager;

const createAgentThatSucceeds: BoundCreateAgentCommand = (async () => ({
  snapshot: { id: "agent-session-1" },
  liveSnapshot: { id: "agent-session-1" },
  background: true,
  initialPromptStarted: true,
  initialPromptError: null,
})) as unknown as BoundCreateAgentCommand;

const executorFor = () =>
  new MulticaExecutor({
    store,
    agentManager: failingAgentManager,
    createAgent: createAgentThatSucceeds,
    resolveWorkspace: async () => ({ cwd: "/tmp/multica-exec-test", workspaceId: "wks-test" }),
    logger: quietLogger,
  });

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

describe("executor failure surface", () => {
  it("a failed run puts an action_required item on the owner's desk", async () => {
    const agent = store.createAgent({ name: "Worker" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    const task = store.createTask({ issueId: issue.id, agentId: agent.id });

    await executorFor().drain();

    expect(store.getTask(task.id).status).toBe("failed");
    const items = store.listInbox({ archived: false });
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("action_required");
    expect(items[0].type).toBe("run.failed");
    expect(items[0].actorId).toBe(agent.id);
    expect(items[0].issueId).toBe(issue.id);
    expect(items[0].body).toContain("provider refused the turn");
    // Unread until the owner says otherwise.
    expect(store.countUnreadInbox()).toBe(1);
  });

  it("a successful run writes a comment, not an inbox item", async () => {
    const agent = store.createAgent({ name: "Worker" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    store.createTask({ issueId: issue.id, agentId: agent.id });
    const okManager = {
      runAgent: async () => ({ finalText: "done" }),
      waitForAgentEvent: async () => ({ permission: false, lastMessage: "done" }),
    } as unknown as AgentManager;

    await new MulticaExecutor({
      store,
      agentManager: okManager,
      createAgent: createAgentThatSucceeds,
      resolveWorkspace: async () => ({ cwd: "/tmp/multica-exec-test", workspaceId: "wks-test" }),
      logger: quietLogger,
    }).drain();

    expect(store.listInbox({ archived: false })).toHaveLength(0);
    expect(store.listCommentsForIssue(issue.id)).toHaveLength(1);
  });
});
