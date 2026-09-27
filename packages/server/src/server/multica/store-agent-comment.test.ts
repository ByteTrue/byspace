/**
 * Tests for the agent and comment store methods.
 *
 * The contracts worth pinning map to the source's sqlc queries: system-kind
 * agents are hidden from lists and resolved by system key (the built-in
 * mechanism the secretary is one instance of), comment creation atomically
 * bumps its issue (no stale updated_at, no comment on a missing issue), and
 * the thread order keeps roots before children in created order.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  store = new MulticaStore(db, { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

describe("agent store", () => {
  it("creates and reads an agent with the source's defaults", () => {
    const agent = store.createAgent({ name: "Frontend Dev" });
    expect(agent.kind).toBe("user");
    expect(agent.permissionMode).toBe("private");
    expect(agent.maxConcurrentTasks).toBe(1);
    expect(store.getAgent(agent.id).name).toBe("Frontend Dev");
  });

  it("hides system agents from the list but resolves them by system key", () => {
    store.createAgent({ name: "Mika", kind: "system", systemKey: "mika" });
    store.createAgent({ name: "Worker A" });
    const visible = store.listAgents();
    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Worker A");
    const chief = store.getAgentBySystemKey("mika");
    expect(chief?.name).toBe("Mika");
    expect(store.getAgentBySystemKey("missing")).toBeNull();
  });

  it("hides archived agents from the default list", () => {
    const a = store.createAgent({ name: "Old" });
    db.prepare("UPDATE agent SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(a.id);
    expect(store.listAgents()).toHaveLength(0);
    expect(store.listAgents({ includeArchived: true })).toHaveLength(1);
  });

  it("updates status and refuses an unknown agent", () => {
    const a = store.createAgent({ name: "A" });
    store.updateAgentStatus(a.id, "working");
    expect(store.getAgent(a.id).status).toBe("working");
    expect(() => store.updateAgentStatus("missing", "idle")).toThrow(/agent not found/);
  });
});

describe("comment store", () => {
  let issueId: string;

  beforeEach(() => {
    issueId = store.createIssue({ title: "t", creatorType: "owner", creatorId: "owner" }).id;
  });

  it("creates a comment and atomically bumps its issue", () => {
    const before = store.getIssue(issueId);
    const comment = store.createComment({
      issueId,
      authorType: "owner",
      authorId: "owner",
      content: "first",
    });
    const after = store.getIssue(issueId);
    // The source's CTE guarantee: same transaction, no stale updated_at.
    expect(after.revision).toBe(before.revision + 1);
    expect(after.lastActivityAt).not.toBeNull();
    expect(comment.revision).toBe(1);
    expect(comment.type).toBe("comment");
  });

  it("refuses a comment on a missing issue without leaving a row", () => {
    expect(() =>
      store.createComment({
        issueId: "nope",
        authorType: "owner",
        authorId: "owner",
        content: "x",
      }),
    ).toThrow(/issue not found/);
    expect((db.prepare("SELECT COUNT(*) AS n FROM comment").get() as { n: number }).n).toBe(0);
  });

  it("lists threads roots-first with children in created order", () => {
    const root = store.createComment({
      issueId,
      authorType: "owner",
      authorId: "owner",
      content: "root",
    });
    store.createComment({
      issueId,
      authorType: "agent",
      authorId: "a1",
      content: "reply 1",
      parentId: root.id,
    });
    store.createComment({
      issueId,
      authorType: "agent",
      authorId: "a2",
      content: "reply 2",
      parentId: root.id,
    });
    store.createComment({
      issueId,
      authorType: "owner",
      authorId: "owner",
      content: "second root",
    });
    const list = store.listCommentsForIssue(issueId);
    // Roots (parent null) first; within each group, created order.
    expect(list.map((c) => c.content)).toEqual(["root", "second root", "reply 1", "reply 2"]);
  });

  it("carries the source task linkage on run-authored comments", () => {
    const comment = store.createComment({
      issueId,
      authorType: "agent",
      authorId: "a1",
      content: "done",
      sourceTaskId: "task-1",
    });
    expect(store.getComment(comment.id).sourceTaskId).toBe("task-1");
  });
});
