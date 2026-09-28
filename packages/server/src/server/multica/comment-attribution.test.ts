/**
 * Comment attribution: who a comment is recorded as belonging to.
 *
 * The issue's record only reads correctly if each line says who spoke it.
 * A run's session attributes to the run's agent; a session that resolves to
 * no run is refused (in this domain an agent speaks on an issue only
 * through a run); no session at all is the owner.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionOutboundMessage } from "@bytetrue/protocol/messages";

import { MulticaSession } from "../session/multica/multica-session.js";
import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;
let emitted: SessionOutboundMessage[];
let session: MulticaSession;

const emitCapture = {
  emit: (msg: SessionOutboundMessage): void => {
    emitted.push(msg);
  },
};

const lastComment = () => {
  const response = emitted.filter(
    (m): m is Extract<SessionOutboundMessage, { type: "multica.comment.create.response" }> =>
      m.type === "multica.comment.create.response",
  );
  return response[response.length - 1]?.payload.comment ?? null;
};

const errorText = () => {
  const errors = emitted.filter(
    (m): m is Extract<SessionOutboundMessage, { type: "rpc_error" }> => m.type === "rpc_error",
  );
  return errors[errors.length - 1]?.payload.error ?? null;
};

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
  emitted = [];
  session = new MulticaSession({ store, host: emitCapture });
});

afterEach(() => {
  store.close();
});

describe("comment attribution", () => {
  it("a run's session attributes the comment to the run's agent", async () => {
    const agent = store.createAgent({ name: "Writer" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    const task = store.createTask({ issueId: issue.id, agentId: agent.id });
    store.attachTaskSession(task.id, "sess-run");

    await session.handle({
      type: "multica.comment.create.request",
      requestId: "r1",
      issueId: issue.id,
      content: "done, reporting",
      senderSessionId: "sess-run",
    });

    const comment = lastComment();
    expect(comment?.authorType).toBe("agent");
    expect(comment?.authorId).toBe(agent.id);
  });

  it("no session attributes to the owner (the human surface)", async () => {
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });

    await session.handle({
      type: "multica.comment.create.request",
      requestId: "r2",
      issueId: issue.id,
      content: "please look at this",
    });

    const comment = lastComment();
    expect(comment?.authorType).toBe("owner");
    expect(comment?.authorId).toBe("owner");
  });

  it("a session that resolves to no run is refused, not believed", async () => {
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });

    await session.handle({
      type: "multica.comment.create.request",
      requestId: "r3",
      issueId: issue.id,
      content: "trust me, I am an agent",
      senderSessionId: "sess-stranger",
    });

    expect(lastComment()).toBeNull();
    expect(errorText()).toContain("is not a multica run");
    expect(store.listCommentsForIssue(issue.id)).toHaveLength(0);
  });
});

describe("inbox writes are run-only", () => {
  it("a run may put an item on the owner's desk", async () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    const task = store.createTask({ issueId: issue.id, agentId: agent.id });
    store.attachTaskSession(task.id, "sess-inbox");

    await session.handle({
      type: "multica.inbox.create.request",
      requestId: "i1",
      severity: "action_required",
      issueId: issue.id,
      title: "needs your decision",
      senderSessionId: "sess-inbox",
    });

    const listed = emitted.filter(
      (m): m is Extract<SessionOutboundMessage, { type: "multica.inbox.create.response" }> =>
        m.type === "multica.inbox.create.response",
    );
    expect(listed).toHaveLength(1);
    expect(listed[0].payload.item.severity).toBe("action_required");
    expect(listed[0].payload.item.actorId).toBe(agent.id);
    expect(store.countUnreadInbox()).toBe(1);
  });

  it("a session that resolves to no run is refused", async () => {
    await session.handle({
      type: "multica.inbox.create.request",
      requestId: "i2",
      severity: "info",
      title: "trust me",
      senderSessionId: "sess-stranger",
    });
    const errors = emitted.filter((m) => m.type === "rpc_error");
    expect(errors).toHaveLength(1);
    expect(store.countUnreadInbox()).toBe(0);
  });

  it("read and mark-all settle the queue", async () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });
    const task = store.createTask({ issueId: issue.id, agentId: agent.id });
    store.attachTaskSession(task.id, "sess-inbox2");
    await session.handle({
      type: "multica.inbox.create.request",
      requestId: "i3",
      severity: "attention",
      issueId: issue.id,
      title: "look at this",
      senderSessionId: "sess-inbox2",
    });
    expect(store.countUnreadInbox()).toBe(1);
    const changed = store.markAllInboxRead();
    expect(changed).toBe(1);
    expect(store.countUnreadInbox()).toBe(0);
  });
});
