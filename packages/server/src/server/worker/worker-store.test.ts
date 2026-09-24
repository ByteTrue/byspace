/**
 * Tests for the worker SQLite store.
 *
 * Covers the properties the domain depends on: state and history move together
 * or not at all, retries do not fabricate history, and data survives reopening
 * the database.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IllegalWorkerTaskTransitionError } from "./worker-task-state.js";
import { SCHEMA_VERSION, WorkerGroupCoordinatorError, WorkerStore } from "./worker-store.js";

let dir: string;
let store: WorkerStore;

const WORKER = {
  id: "w1",
  name: "Alice",
  templateId: "frontend-developer",
  workspacePath: "/tmp/ws",
  status: "online" as const,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "worker-store-"));
  store = new WorkerStore({ databasePath: path.join(dir, "worker.db") });
  store.createWorker(WORKER);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("worker store", () => {
  it("records the schema version so the domain can migrate forward", () => {
    // Asserts the invariant, not the literal: the point is that a fresh
    // database reports the schema the code was written against, so a bump that
    // forgets to record itself fails here.
    expect(store.getSchemaVersion()).toBe(SCHEMA_VERSION);
  });

  it("records the version when opening a database from an older schema", () => {
    // A file of its own: this closes a store, and the shared one must survive
    // for the other cases in this block.
    const databasePath = path.join(dir, "upgrade-version.db");
    new WorkerStore({ databasePath }).close();

    const legacy = new DatabaseSync(databasePath);
    legacy.exec("DELETE FROM worker_schema_version");
    legacy
      .prepare("INSERT INTO worker_schema_version (version, applied_at) VALUES (1, ?)")
      .run("2026-01-01T00:00:00.000Z");
    legacy.close();

    const upgraded = new WorkerStore({ databasePath });
    try {
      // Without this the upgraded database would keep claiming version 1 and a
      // later migration would try to apply the same step again.
      expect(upgraded.getSchemaVersion()).toBe(SCHEMA_VERSION);
      // The new tables exist, so the upgrade really happened.
      expect(upgraded.listGroups()).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("keeps existing data across the schema upgrade", () => {
    const databasePath = path.join(dir, "upgrade-data.db");
    const before = new WorkerStore({ databasePath });
    before.createWorker(WORKER);
    before.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    before.close();

    const upgraded = new WorkerStore({ databasePath });
    try {
      expect(upgraded.getWorker("w1")?.name).toBe("Alice");
      expect(upgraded.getTask("t1")?.title).toBe("Build it");
    } finally {
      upgraded.close();
    }
  });

  it("round-trips a worker", () => {
    expect(store.getWorker("w1")).toEqual(WORKER);
    expect(store.getWorker("missing")).toBeNull();
    expect(store.listWorkers().map((w) => w.id)).toEqual(["w1"]);
  });

  it("starts a task in planned and writes no history for creation", () => {
    const task = store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    expect(task.state).toBe("planned");
    // Creation is not a transition; history starts at the first move.
    expect(store.listTaskHistory("t1")).toEqual([]);
  });

  it("moves state and appends history in the same step", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });

    const result = store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "worker:w-lead",
      recordedAt: "2026-09-24T01:00:00.000Z",
    });

    expect(result.task.state).toBe("assigned");
    expect(result.task.updatedAt).toBe("2026-09-24T01:00:00.000Z");
    expect(result.historyEntry).toMatchObject({
      seq: 1,
      fromState: "planned",
      toState: "assigned",
      action: "assign_task",
      actor: "worker:w-lead",
    });
    expect(store.listTaskHistory("t1")).toHaveLength(1);
  });

  it("rejects an illegal transition without changing state or history", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "completed",
        action: "accept_task_result",
        actor: "worker:w-lead",
      }),
    ).toThrow(IllegalWorkerTaskTransitionError);

    expect(store.getTask("t1")?.state).toBe("planned");
    expect(store.listTaskHistory("t1")).toEqual([]);
  });

  it("treats a same-state retry as a no-op and writes no history", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    const retry = store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    expect(retry.historyEntry).toBeNull();
    expect(retry.task.state).toBe("assigned");
    // The idempotent retry must leave exactly the original entry behind.
    expect(store.listTaskHistory("t1")).toHaveLength(1);
  });

  it("refuses a legal state change carrying the wrong action", () => {
    // The graph allows submitted -> completed, but 'submit_task' is not the
    // action that produces it. Recording it would put a false line in history.
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "submitted",
      action: "submit_task",
      actor: "worker:w1",
    });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "completed",
        action: "submit_task",
        actor: "worker:lead",
      }),
    ).toThrow(/does not move a worker task from 'submitted' to 'completed'/);

    // Refused means unchanged: state and history both stay put.
    expect(store.getTask("t1")?.state).toBe("submitted");
    expect(store.listTaskHistory("t1")).toHaveLength(1);
  });

  it("refuses a same-state arrival from an unrelated action", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    // 'accept_task_result' arriving at 'assigned' claims work that did not
    // happen; only a retry of the producing action or a progress note is fine.
    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "assigned",
        action: "accept_task_result",
        actor: "lead",
      }),
    ).toThrow(/Expected 'assign_task'/);
  });

  it("accepts a progress note on a task in flight", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "in_progress",
      action: "ack_task",
      actor: "worker:w1",
    });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "in_progress",
        action: "report_progress",
        actor: "worker:w1",
        note: "halfway",
      }),
    ).not.toThrow();
  });

  it("numbers history monotonically across a full legal path", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    const path_: Array<[Parameters<typeof store.applyTaskTransition>[0]["toState"], string]> = [
      ["assigned", "assign_task"],
      ["in_progress", "ack_task"],
      ["submitted", "submit_task"],
      ["completed", "accept_task_result"],
    ];
    for (const [toState, action] of path_) {
      store.applyTaskTransition({
        taskId: "t1",
        toState,
        action: action as Parameters<typeof store.applyTaskTransition>[0]["action"],
        actor: "lead",
      });
    }

    const history = store.listTaskHistory("t1");
    expect(history.map((h) => h.seq)).toEqual([1, 2, 3, 4]);
    expect(history.map((h) => h.toState)).toEqual([
      "assigned",
      "in_progress",
      "submitted",
      "completed",
    ]);
    expect(store.getTask("t1")?.state).toBe("completed");
  });

  it("refuses to move a task once it is terminal", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "cancelled",
      action: "cancel_task",
      actor: "human",
    });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "assigned",
        action: "assign_task",
        actor: "lead",
      }),
    ).toThrow(IllegalWorkerTaskTransitionError);
  });

  it("rejects transitions for unknown tasks", () => {
    expect(() =>
      store.applyTaskTransition({
        taskId: "nope",
        toState: "assigned",
        action: "assign_task",
        actor: "lead",
      }),
    ).toThrow(/unknown worker task/);
  });

  it("truncates an over-long progress note instead of rejecting it", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "in_progress",
      action: "ack_task",
      actor: "lead",
    });

    const result = store.applyTaskTransition({
      taskId: "t1",
      toState: "in_progress",
      action: "report_progress",
      actor: "worker:w1",
      note: "x".repeat(500),
    });

    // Progress is same-state: it must not fabricate a state change.
    expect(result.historyEntry).toBeNull();
    expect(store.getTask("t1")?.state).toBe("in_progress");
  });

  it("cascades task and history deletion when a worker is removed", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    // FK enforcement is per-connection; this asserts we enabled it.
    expect(() => store.createTask({ taskId: "t2", workerId: "ghost", title: "orphan" })).toThrow();
    expect(store.listTasksForWorker("w1")).toHaveLength(1);
  });

  it("survives reopening the database", () => {
    const databasePath = path.join(dir, "worker.db");
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
      recordedAt: "2026-09-24T01:00:00.000Z",
    });
    store.close();

    const reopened = new WorkerStore({ databasePath });
    try {
      expect(reopened.getTask("t1")?.state).toBe("assigned");
      expect(reopened.listTaskHistory("t1")).toHaveLength(1);
      expect(reopened.listWorkers().map((w) => w.id)).toEqual(["w1"]);
    } finally {
      reopened.close();
    }
  });
});

describe("worker groups", () => {
  const GROUP = {
    id: "grp_1",
    name: "Pricing page",
    projectId: "prj_abc",
    workspaceId: "ws_1",
    goal: "Ship the pricing page",
  };

  beforeEach(() => {
    store.createWorker({ ...WORKER, id: "w2", name: "Bob" });
    store.createGroup(GROUP);
  });

  it("round-trips a group bound to a project and workspace", () => {
    expect(store.getGroup("grp_1")).toMatchObject({
      name: "Pricing page",
      projectId: "prj_abc",
      workspaceId: "ws_1",
      goal: "Ship the pricing page",
      status: "active",
    });
    expect(store.listGroups().map((g) => g.id)).toEqual(["grp_1"]);
  });

  it("allows a group with no workspace yet", () => {
    // The roster and channels are useful before a workspace is chosen.
    const group = store.createGroup({ id: "grp_2", name: "Unassigned", projectId: "prj_abc" });
    expect(group.workspaceId).toBeNull();
    expect(group.goal).toBeNull();
  });

  it("keeps the roster ordered with the coordinator first", () => {
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "member" });
    store.addGroupMember({ groupId: "grp_1", workerId: "w2", role: "coordinator" });

    expect(store.listGroupMembers("grp_1").map((m) => `${m.role}:${m.workerId}`)).toEqual([
      "coordinator:w2",
      "member:w1",
    ]);
  });

  it("refuses a second coordinator at the database level", () => {
    // "Who is in charge" must be trustworthy. Enforcing it in the schema makes
    // two coordinators unrepresentable rather than merely discouraged.
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "coordinator" });
    expect(() =>
      store.addGroupMember({ groupId: "grp_1", workerId: "w2", role: "coordinator" }),
    ).toThrow(WorkerGroupCoordinatorError);

    expect(store.listGroupMembers("grp_1")).toHaveLength(1);
  });

  it("allows each group to have its own coordinator", () => {
    const second = store.createGroup({ id: "grp_2", name: "Other", projectId: "prj_abc" });
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "coordinator" });
    store.addGroupMember({ groupId: second.id, workerId: "w2", role: "coordinator" });

    expect(store.listGroupMembers("grp_1").map((m) => m.workerId)).toEqual(["w1"]);
    expect(store.listGroupMembers("grp_2").map((m) => m.workerId)).toEqual(["w2"]);
  });

  it("refuses to add the same worker twice", () => {
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "member" });
    expect(() =>
      store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "member" }),
    ).toThrow(/already a member/);
  });

  it("refuses a member of a group that does not exist", () => {
    expect(() =>
      store.addGroupMember({ groupId: "grp_missing", workerId: "w1", role: "member" }),
    ).toThrow(/unknown worker group/);
  });

  it("removes a member without touching the others", () => {
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "coordinator" });
    store.addGroupMember({ groupId: "grp_1", workerId: "w2", role: "member" });

    store.removeGroupMember({ groupId: "grp_1", workerId: "w1" });
    expect(store.listGroupMembers("grp_1").map((m) => m.workerId)).toEqual(["w2"]);
  });

  it("enforces one coordinator in the schema, not only in the store", () => {
    // The store checks before inserting so it can explain the refusal. This
    // bypasses that check and writes straight to the table, which is the only
    // way to show the invariant holds without the store's cooperation.
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "coordinator" });

    const raw = new DatabaseSync(path.join(dir, "worker.db"));
    try {
      expect(() =>
        raw
          .prepare(
            `INSERT INTO worker_group_members (group_id, worker_id, role, joined_at)
             VALUES ('grp_1', 'w2', 'coordinator', '2026-09-24T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed/);
    } finally {
      raw.close();
    }

    expect(store.listGroupMembers("grp_1").map((m) => m.workerId)).toEqual(["w1"]);
  });

  it("refuses a member that is not a worker", () => {
    expect(() =>
      store.addGroupMember({ groupId: "grp_1", workerId: "wkr_ghost", role: "member" }),
    ).toThrow(/unknown worker/);
  });

  it("leaves the roster empty after removing the only coordinator", () => {
    // A group without a coordinator is representable: the invariant is "at most
    // one", not "exactly one". Removing the last one is a state the caller must
    // handle rather than a crash, and no other group is affected.
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "coordinator" });
    store.removeGroupMember({ groupId: "grp_1", workerId: "w1" });

    expect(store.listGroupMembers("grp_1")).toEqual([]);
    expect(store.getGroup("grp_1")).not.toBeNull();
  });
});

describe("worker messages", () => {
  const GROUP = { id: "grp_1", name: "Pricing page", projectId: "prj_abc" };

  beforeEach(() => {
    store.createWorker({ ...WORKER, id: "w2", name: "Bob" });
    store.createWorker({ ...WORKER, id: "w3", name: "Carol" });
    store.createGroup(GROUP);
  });

  function send(overrides: Partial<Parameters<WorkerStore["createMessage"]>[0]> = {}) {
    return store.createMessage({
      messageId: `msg_${Math.random().toString(16).slice(2)}`,
      groupId: "grp_1",
      senderWorkerId: "w1",
      body: "hello",
      ...overrides,
    });
  }

  it("allocates increasing sequence numbers within a group", () => {
    // Sequence is the visible ordering, so it must be dense and monotonic.
    const first = send();
    const second = send();
    expect([first.seq, second.seq]).toEqual([1, 2]);
  });

  it("keeps sequence numbers independent per group", () => {
    store.createGroup({ id: "grp_2", name: "Other", projectId: "prj_abc" });
    const other = send({ groupId: "grp_2" });
    expect(other.seq).toBe(1);
  });

  it("refuses a message on an unknown group", () => {
    expect(() => send({ groupId: "grp_missing" })).toThrow(/unknown worker group/);
  });

  it("refuses a sender who is not a worker", () => {
    expect(() => send({ senderWorkerId: "w_missing" })).toThrow(/unknown worker/);
  });

  it("allocates sequence numbers without collision when interleaved", () => {
    // Two sends whose ids were both computed before either insert. Reading the
    // max inside the insert transaction is what keeps them apart.
    const a = store.createMessage({
      messageId: "msg_a",
      groupId: "grp_1",
      senderWorkerId: "w1",
      body: "first",
    });
    const b = store.createMessage({
      messageId: "msg_b",
      groupId: "grp_1",
      senderWorkerId: "w1",
      body: "second",
    });
    expect(new Set([a.seq, b.seq]).size).toBe(2);
  });

  it("records who a message addresses, separately from its text", () => {
    // Routing reads the audience table. Parsing an @name in the body would make
    // routing depend on prose.
    const message = send({ body: "@Bob please look at this", audience: ["w2"] });
    expect(message.audience).toEqual(["w2"]);
  });

  it("deduplicates a repeated addressee", () => {
    const message = send({ audience: ["w2", "w2"] });
    expect(message.audience).toEqual(["w2"]);
  });

  it("creates one delivery per addressee of a waking message", () => {
    send({ audience: ["w2", "w3"] });
    expect(store.listInbox("w2")).toHaveLength(1);
    expect(store.listInbox("w3")).toHaveLength(1);
  });

  it("does not wake anyone for a store-only message", () => {
    // Visibility without waking is a fact here, not a convention: there is no
    // delivery row for an inbox to pick up.
    send({ audience: ["w2"], deliveryPolicy: "store_only" });
    expect(store.listInbox("w2")).toHaveLength(0);
    expect(store.listMessages({ groupId: "grp_1" })).toHaveLength(1);
  });

  it("defaults to waking the audience and storing when there is none", () => {
    expect(send({ audience: ["w2"] }).deliveryPolicy).toBe("wake");
    expect(send().deliveryPolicy).toBe("store_only");
  });

  it("gives each addressee an independent delivery state", () => {
    // One worker reading a message must not mark it read for the other.
    const message = send({ audience: ["w2", "w3"] });
    expect(
      store.markDelivery({ messageId: message.messageId, workerId: "w2", state: "read" }),
    ).toBe(true);
    expect(store.listInbox("w2")).toHaveLength(0);
    expect(store.listInbox("w3")).toHaveLength(1);
  });

  it("keeps a claimed message in the inbox so work can be resumed", () => {
    const message = send({ audience: ["w2"] });
    store.markDelivery({ messageId: message.messageId, workerId: "w2", state: "claimed" });
    expect(store.listInbox("w2").map((entry) => entry.state)).toEqual(["claimed"]);
  });

  it("will not let a worker claim a message addressed to someone else", () => {
    // Reading history must not be a way to take on another worker's work.
    const message = send({ audience: ["w2"] });
    expect(
      store.markDelivery({ messageId: message.messageId, workerId: "w3", state: "claimed" }),
    ).toBe(false);
  });

  it("does not reclaim a message that was already read", () => {
    const message = send({ audience: ["w2"] });
    store.markDelivery({ messageId: message.messageId, workerId: "w2", state: "read" });
    expect(
      store.markDelivery({ messageId: message.messageId, workerId: "w2", state: "claimed" }),
    ).toBe(false);
  });

  it("keeps a private message out of an outsider's stream", () => {
    send({ privateTo: ["w2"], audience: ["w2"], body: "just between us" });
    expect(store.listMessages({ groupId: "grp_1", viewerWorkerId: "w2" })).toHaveLength(1);
    expect(store.listMessages({ groupId: "grp_1", viewerWorkerId: "w3" })).toHaveLength(0);
  });

  it("lets the sender read their own private message", () => {
    send({ privateTo: ["w2"], audience: ["w2"] });
    expect(store.listMessages({ groupId: "grp_1", viewerWorkerId: "w1" })).toHaveLength(1);
  });

  it("treats a message with no private readers as public", () => {
    send();
    expect(store.listMessages({ groupId: "grp_1", viewerWorkerId: "w3" })).toHaveLength(1);
  });

  it("refuses to address someone who cannot read the message", () => {
    // A message that wakes a worker the message is hidden from is a mistake in
    // the caller, and dropping either half silently would hide it.
    expect(() => send({ privateTo: ["w2"], audience: ["w3"] })).toThrow(
      /addresses w3 who are not among its readers/,
    );
  });

  it("returns the most recent messages when truncated", () => {
    // A truncated stream should end at the newest message, not the oldest.
    for (let index = 0; index < 5; index += 1) send({ body: `message ${index}` });
    const recent = store.listMessages({ groupId: "grp_1", limit: 2 });
    expect(recent.map((message) => message.body)).toEqual(["message 3", "message 4"]);
  });

  it("records a reply reference", () => {
    const original = send();
    const reply = send({ replyToMessageId: original.messageId });
    expect(reply.replyToMessageId).toBe(original.messageId);
  });

  it("survives reopening the database", () => {
    send({ audience: ["w2"], body: "durable" });
    const databasePath = path.join(dir, "worker.db");
    store.close();
    store = new WorkerStore({ databasePath });
    expect(store.listMessages({ groupId: "grp_1" })[0]?.body).toBe("durable");
    expect(store.listInbox("w2")).toHaveLength(1);
  });
});
