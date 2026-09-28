/**
 * The owner's inbox has no agent face: a run session that tries to list,
 * mark, archive, or mark-all it is refused, while creating an item — the
 * one agent→owner direction — stays open, and the owner's own paths are
 * untouched.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionInboundMessage, SessionOutboundMessage } from "@bytetrue/protocol/messages";

import { MulticaSession } from "../session/multica/multica-session.js";
import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;
let session: MulticaSession;
let emitted: SessionOutboundMessage[];

const emitCapture = {
  emit: (msg: SessionOutboundMessage): void => {
    emitted.push(msg);
  },
};

const send = async (message: SessionInboundMessage): Promise<void> => {
  emitted = [];
  await session.handle(message as never);
};

const lastError = (): string | null => {
  const error = emitted.find((msg) => msg.type === "rpc_error");
  return error && error.type === "rpc_error" ? error.payload.error : null;
};

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
  session = new MulticaSession({ store, host: emitCapture });
  emitted = [];
});

afterEach(() => {
  store.close();
});

const seedRun = (): string => {
  const agent = store.createAgent({ name: "Runner" });
  const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
  const task = store.createTask({ agentId: agent.id, issueId: issue.id });
  store.updateTaskStatus({ id: task.id, status: "running" });
  store.attachTaskSession(task.id, "run-session-1");
  return "run-session-1";
};

describe("the owner's inbox is owner-only", () => {
  it("a run session cannot list the queue", async () => {
    seedRun();
    await send({
      type: "multica.inbox.list.request",
      requestId: "r1",
      senderSessionId: "run-session-1",
    });
    expect(lastError()).toMatch(/not an agent surface/);
  });

  it("a run session cannot mark or archive items", async () => {
    const runSession = seedRun();
    const item = store.createInboxItem({
      type: "agent.escalation",
      severity: "action_required",
      title: "decide",
      body: "x",
      actorType: "agent",
      actorId: "a",
    });
    await send({
      type: "multica.inbox.mark.request",
      requestId: "r2",
      id: item.id,
      read: true,
      senderSessionId: runSession,
    });
    expect(lastError()).toMatch(/not an agent surface/);
    await send({
      type: "multica.inbox.archive.request",
      requestId: "r3",
      id: item.id,
      archived: true,
      senderSessionId: runSession,
    });
    expect(lastError()).toMatch(/not an agent surface/);
    expect(store.listInbox({ archived: false })).toHaveLength(1);
  });

  it("a run session cannot mark-all", async () => {
    seedRun();
    await send({
      type: "multica.inbox.mark_all.request",
      requestId: "r4",
      senderSessionId: "run-session-1",
    });
    expect(lastError()).toMatch(/not an agent surface/);
  });

  it("the owner's paths and an agent's create stay open", async () => {
    seedRun();
    await send({ type: "multica.inbox.list.request", requestId: "r5" });
    expect(lastError()).toBeNull();
    await send({
      type: "multica.inbox.create.request",
      requestId: "r6",
      severity: "action_required",
      title: "from a run",
      senderSessionId: "run-session-1",
    });
    expect(lastError()).toBeNull();
    expect(store.listInbox({ archived: false })).toHaveLength(1);
  });
});
