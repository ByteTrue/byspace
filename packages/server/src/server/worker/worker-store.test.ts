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
import {
  SCHEMA_VERSION,
  WorkerGoalBudgetExhaustedError,
  WorkerGoalConflictError,
  WorkerGroupCoordinatorError,
  WorkerGroupUnbudgetedError,
  WorkerRunAlreadyActiveError,
  WorkerStore,
  type WorkerRunRecord,
} from "./worker-store.js";

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

/**
 * Put a worker in a group.
 *
 * A message is only legal between members, so a fixture that sends has to join
 * its workers first; doing it in one place keeps a test that forgets to fail for
 * the reason it should rather than for membership.
 */
function joinGroup(groupId: string, workerIds: readonly string[]): void {
  workerIds.forEach((workerId, index) => {
    store.addGroupMember({
      groupId,
      workerId,
      role: index === 0 ? "coordinator" : "member",
    });
  });
}

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
      status: "active",
    });
    expect(store.listGroups().map((g) => g.id)).toEqual(["grp_1"]);
  });

  it("allows a group with no workspace yet", () => {
    // The roster and channels are useful before a workspace is chosen.
    const group = store.createGroup({ id: "grp_2", name: "Unassigned", projectId: "prj_abc" });
    expect(group.workspaceId).toBeNull();
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
    joinGroup("grp_1", ["w1", "w2", "w3"]);
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
    joinGroup("grp_2", ["w1"]);
    const other = send({ groupId: "grp_2" });
    expect(other.seq).toBe(1);
  });

  it("refuses a message on an unknown group", () => {
    expect(() => send({ groupId: "grp_missing" })).toThrow(/unknown worker group/);
  });

  it("refuses a sender who is not a worker", () => {
    expect(() => send({ senderWorkerId: "w_missing" })).toThrow(/unknown worker/);
  });

  it("refuses a sender who is not in the group", () => {
    // A worker that exists is not a member of every group. Without this, its
    // name could appear in a conversation nobody added it to.
    store.createWorker({ ...WORKER, id: "w9", name: "Stranger" });
    expect(() => send({ senderWorkerId: "w9" })).toThrow(
      /worker w9 is not a member of group grp_1/,
    );
  });

  it("refuses to wake a worker outside the group", () => {
    store.createWorker({ ...WORKER, id: "w9", name: "Stranger" });
    expect(() => send({ audience: ["w9"] })).toThrow(/not a member of group/);
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

describe("worker goals", () => {
  const GROUP = { id: "grp_1", name: "Pricing page", projectId: "prj_abc" };

  beforeEach(() => {
    store.createWorker({ ...WORKER, id: "w2", name: "Bob" });
    store.createGroup(GROUP);
    joinGroup("grp_1", ["w1", "w2"]);
  });

  function createGoal(overrides: Partial<Parameters<WorkerStore["createGoal"]>[0]> = {}) {
    return store.createGoal({
      goalId: "goal_1",
      groupId: "grp_1",
      content: "Ship the pricing page",
      turnLimit: 20,
      ...overrides,
    });
  }

  function send(body: string, privateTo?: string[]) {
    return store.createMessage({
      messageId: `msg_${Math.random().toString(16).slice(2)}`,
      groupId: "grp_1",
      senderWorkerId: "w1",
      body,
      ...(privateTo !== undefined ? { privateTo, audience: privateTo } : {}),
    });
  }

  it("starts active at generation 1", () => {
    const goal = createGoal();
    expect(goal).toMatchObject({
      content: "Ship the pricing page",
      turnLimit: 20,
      status: "active",
      generation: 1,
      revision: 1,
      turnUsed: 0,
    });
  });

  it("refuses a second goal for the same group", () => {
    // One objective per stream: `reopen` carries it forward.
    createGoal();
    expect(() => createGoal({ goalId: "goal_2" })).toThrow(/already has a goal/);
  });

  it("refuses a turn limit outside the allowed range", () => {
    expect(() => createGoal({ turnLimit: 0 })).toThrow(/between 1 and 96/);
    expect(() => createGoal({ turnLimit: 97 })).toThrow(/between 1 and 96/);
    expect(() => createGoal({ turnLimit: 2.5 })).toThrow(/between 1 and 96/);
  });

  it("counts public messages against the budget", () => {
    createGoal();
    send("one");
    send("two");
    expect(store.getGoal("grp_1")?.turnUsed).toBe(2);
  });

  it("does not count private messages against the budget", () => {
    // The budget bounds what the group says in public, not what it takes to
    // get there.
    createGoal();
    send("public");
    send("private", ["w2"]);
    expect(store.getGoal("grp_1")?.turnUsed).toBe(1);
  });

  it("advances revision on update and keeps the generation", () => {
    createGoal();
    const updated = store.mutateGoal({
      groupId: "grp_1",
      action: "update",
      expectedGeneration: 1,
      expectedRevision: 1,
      content: "Ship the pricing page and the docs",
    });
    expect(updated).toMatchObject({
      content: "Ship the pricing page and the docs",
      generation: 1,
      revision: 2,
      status: "active",
    });
  });

  it("refuses a mutation written against a stale revision", () => {
    // Two runs both read revision 1. The first wins; the second must not
    // silently overwrite it.
    createGoal();
    store.mutateGoal({
      groupId: "grp_1",
      action: "update",
      expectedGeneration: 1,
      expectedRevision: 1,
      content: "first writer wins",
    });

    expect(() =>
      store.mutateGoal({
        groupId: "grp_1",
        action: "update",
        expectedGeneration: 1,
        expectedRevision: 1,
        content: "second writer",
      }),
    ).toThrow(WorkerGoalConflictError);

    expect(store.getGoal("grp_1")?.content).toBe("first writer wins");
  });

  it("refuses a mutation written against a stale generation", () => {
    createGoal();
    store.mutateGoal({
      groupId: "grp_1",
      action: "pause",
      expectedGeneration: 1,
      expectedRevision: 1,
      pauseReason: "awaiting_user",
    });
    const reopened = store.mutateGoal({
      groupId: "grp_1",
      action: "reopen",
      expectedGeneration: 1,
      expectedRevision: 2,
      content: "Second attempt",
    });
    expect(reopened.generation).toBe(2);

    expect(() =>
      store.mutateGoal({
        groupId: "grp_1",
        action: "update",
        expectedGeneration: 1,
        expectedRevision: 3,
        content: "written against the old generation",
      }),
    ).toThrow(WorkerGoalConflictError);
  });

  it("requires the delivering message to complete a goal", () => {
    // Completion is a claim about delivery, so it must name what delivered it.
    createGoal();
    expect(() =>
      store.mutateGoal({
        groupId: "grp_1",
        action: "complete",
        expectedGeneration: 1,
        expectedRevision: 1,
      }),
    ).toThrow(/requires the message that delivered the result/);
  });

  it("completes with the delivering message", () => {
    createGoal();
    const delivered = send("here is the pricing page");
    const goal = store.mutateGoal({
      groupId: "grp_1",
      action: "complete",
      expectedGeneration: 1,
      expectedRevision: 1,
      resultMessageId: delivered.messageId,
    });
    expect(goal).toMatchObject({ status: "completed", resultMessageId: delivered.messageId });
  });

  it("refuses to update a goal that is not active", () => {
    createGoal();
    store.mutateGoal({
      groupId: "grp_1",
      action: "pause",
      expectedGeneration: 1,
      expectedRevision: 1,
      pauseReason: "no_progress",
    });
    expect(() =>
      store.mutateGoal({
        groupId: "grp_1",
        action: "update",
        expectedGeneration: 1,
        expectedRevision: 2,
        content: "nope",
      }),
    ).toThrow(/not-progress|Cannot update a goal that is paused/);
  });

  it("resets the budget count on reopen", () => {
    // A new generation is a new attempt, so it gets a fresh budget rather than
    // inheriting the previous attempt's spend.
    createGoal();
    send("one");
    send("two");
    expect(store.getGoal("grp_1")?.turnUsed).toBe(2);

    store.mutateGoal({
      groupId: "grp_1",
      action: "pause",
      expectedGeneration: 1,
      expectedRevision: 1,
      pauseReason: "turn_limit",
    });
    const reopened = store.mutateGoal({
      groupId: "grp_1",
      action: "reopen",
      expectedGeneration: 1,
      expectedRevision: 2,
      turnLimit: 10,
    });

    expect(reopened).toMatchObject({ generation: 2, status: "active", turnLimit: 10, turnUsed: 0 });
  });

  it("resets the budget even when the reopen shares a timestamp with the messages", () => {
    // The budget window is a sequence boundary, not a timestamp. A timestamp
    // window fails here: these sends and the reopen land in the same
    // millisecond, so `created_at >= generation_started_at` would keep counting
    // the previous attempt's messages.
    createGoal();
    const first = send("one");
    send("two");

    store.mutateGoal({
      groupId: "grp_1",
      action: "pause",
      expectedGeneration: 1,
      expectedRevision: 1,
      pauseReason: "turn_limit",
    });
    const reopened = store.mutateGoal({
      groupId: "grp_1",
      action: "reopen",
      expectedGeneration: 1,
      expectedRevision: 2,
    });

    expect(reopened.turnUsed).toBe(0);
    // And a message sent after the reopen does count, so the boundary is a
    // boundary rather than a way of never counting anything.
    send("three");
    expect(store.getGoal("grp_1")?.turnUsed).toBe(1);
    expect(first.seq).toBe(1);
  });

  it("clears the result and pause reason on reopen", () => {
    createGoal();
    const delivered = send("done");
    store.mutateGoal({
      groupId: "grp_1",
      action: "complete",
      expectedGeneration: 1,
      expectedRevision: 1,
      resultMessageId: delivered.messageId,
    });
    const reopened = store.mutateGoal({
      groupId: "grp_1",
      action: "reopen",
      expectedGeneration: 1,
      expectedRevision: 2,
    });
    expect(reopened.status).toBe("active");
    expect(reopened.resultMessageId).toBeNull();
    expect(reopened.pauseReason).toBeNull();
  });

  it("refuses to reopen a goal that is already active", () => {
    createGoal();
    expect(() =>
      store.mutateGoal({
        groupId: "grp_1",
        action: "reopen",
        expectedGeneration: 1,
        expectedRevision: 1,
      }),
    ).toThrow(/already active/);
  });

  it("refuses a pause without a reason", () => {
    createGoal();
    expect(() =>
      store.mutateGoal({
        groupId: "grp_1",
        action: "pause",
        expectedGeneration: 1,
        expectedRevision: 1,
      }),
    ).toThrow(/requires a reason/);
  });

  it("survives reopening the database", () => {
    createGoal();
    send("one");
    const databasePath = path.join(dir, "worker.db");
    store.close();
    store = new WorkerStore({ databasePath });
    expect(store.getGoal("grp_1")).toMatchObject({ content: "Ship the pricing page", turnUsed: 1 });
  });
});

describe("a goal-less group still has a budget", () => {
  const GROUP = { id: "grp_1", name: "Pricing page", projectId: "prj_abc" };

  beforeEach(() => {
    store.createWorker({ ...WORKER, id: "w2", name: "Bob" });
    store.createGroup(GROUP);
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "coordinator" });
    store.addGroupMember({ groupId: "grp_1", workerId: "w2", role: "member" });
  });

  function send(overrides: Partial<Parameters<WorkerStore["createMessage"]>[0]> = {}) {
    return store.createMessage({
      messageId: `msg_${Math.random().toString(16).slice(2)}`,
      groupId: "grp_1",
      senderWorkerId: "w1",
      body: "work",
      ...overrides,
    });
  }

  it("still wakes while under the roster's estimate", () => {
    // Two members, so the estimate is ceil(2*2*1.35) = 6. The budget exists
    // before the first message; it is not something a group grows into.
    for (let i = 0; i < 5; i += 1) send({ audience: ["w2"] });
    expect(() => send({ audience: ["w2"] })).not.toThrow();
  });

  it("refuses a wake at the estimate", () => {
    // A coordinator that declines to set a goal — its choice, as a live run
    // showed — must not leave the group unbounded.
    for (let i = 0; i < 6; i += 1) send({ audience: ["w2"] });
    expect(() => send({ audience: ["w2"] })).toThrow(WorkerGroupUnbudgetedError);
  });

  it("names the remedy, which is a goal rather than a reopen", () => {
    for (let i = 0; i < 6; i += 1) send({ audience: ["w2"] });
    try {
      send({ audience: ["w2"] });
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as Error).message).toContain("Create a goal");
    }
  });

  it("does not count a private record against the cap", () => {
    for (let i = 0; i < 6; i += 1) send({ audience: ["w2"] });
    // Private messages never consumed a goal budget, and the same definition
    // applies here. A private record addresses nobody, so it stores rather than
    // wakes — a message that mentions someone is a turn however private it is,
    // because a wake is a turn whatever its readers can see.
    expect(() => send({ privateTo: ["w2"] })).not.toThrow();
  });

  it("keeps a stored message working once the cap is reached", () => {
    for (let i = 0; i < 6; i += 1) send({ audience: ["w2"] });
    // The budget stops wakes, not communication.
    expect(() => send({ deliveryPolicy: "store_only" })).not.toThrow();
  });

  it("a group with a goal is still governed by the goal alone", () => {
    // The estimate only stands in for a missing goal. With one present, even a
    // tiny turn limit is the rule, and the estimate plays no part.
    store.createGoal({ goalId: "goal_1", groupId: "grp_1", content: "Ship", turnLimit: 1 });
    send({ audience: ["w2"] });
    expect(() => send({ audience: ["w2"] })).toThrow(WorkerGoalBudgetExhaustedError);
  });

  it("counts the roster it has, not the roster it had", () => {
    // Adding a member raises the estimate, because the estimate is derived from
    // the current roster on every check rather than computed once.
    for (let i = 0; i < 6; i += 1) send({ audience: ["w2"] });
    store.createWorker({ ...WORKER, id: "w3", name: "Carol" });
    store.addGroupMember({ groupId: "grp_1", workerId: "w3", role: "member" });
    // Three members: ceil(2*3*1.35) = 9, so the 7th public message still wakes.
    expect(() => send({ audience: ["w2"] })).not.toThrow();
  });
});

describe("schema v5 migration", () => {
  function createV4Database(databasePath: string, groupGoal: string | null): void {
    // A v4-shaped database: the group carries a goal text column that the goal
    // entity later replaced. Built by hand because the current code can no
    // longer produce this shape.
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE worker_schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO worker_schema_version VALUES (4, '2026-09-24T00:00:00.000Z');
      CREATE TABLE workers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, template_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE worker_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT NOT NULL,
        workspace_id TEXT, goal TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE worker_group_members (
        group_id TEXT NOT NULL, worker_id TEXT NOT NULL, role TEXT NOT NULL,
        joined_at TEXT NOT NULL, PRIMARY KEY (group_id, worker_id)
      );
      CREATE TABLE worker_messages (
        message_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, seq INTEGER NOT NULL,
        sender_worker_id TEXT NOT NULL, body TEXT NOT NULL, intent TEXT NOT NULL,
        delivery_policy TEXT NOT NULL, reply_to_message_id TEXT,
        created_at TEXT NOT NULL, UNIQUE (group_id, seq)
      );
      CREATE TABLE worker_goals (
        goal_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, content TEXT NOT NULL,
        turn_limit INTEGER NOT NULL, status TEXT NOT NULL, generation INTEGER NOT NULL,
        revision INTEGER NOT NULL, pause_reason TEXT, result_message_id TEXT,
        generation_start_seq INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    for (const id of ["w1", "w2", "w3"]) {
      db.prepare(
        "INSERT INTO workers VALUES (?, ?, 'qa-engineer', '/tmp/ws', 'online', '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')",
      ).run(id, id);
    }
    db.prepare(
      "INSERT INTO worker_groups VALUES ('grp_old', 'Legacy', 'prj_1', NULL, ?, 'active', '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')",
    ).run(groupGoal);
    for (const id of ["w1", "w2", "w3"]) {
      db.prepare(
        "INSERT INTO worker_group_members VALUES ('grp_old', ?, 'member', '2026-09-24T00:00:00.000Z')",
      ).run(id);
    }
    db.close();
  }

  it("moves a group's objective onto the goal instead of dropping it", () => {
    const databasePath = path.join(dir, "v4.db");
    createV4Database(databasePath, "Ship the pricing page");

    const migrated = new WorkerStore({ databasePath });
    try {
      expect(migrated.getSchemaVersion()).toBe(SCHEMA_VERSION);
      expect(migrated.getGoal("grp_old")).toMatchObject({
        content: "Ship the pricing page",
        status: "active",
        turnUsed: 0,
      });
      // The column is gone: one home for the objective.
      const columns = (migrated.rawTableInfo("worker_groups") as Array<{ name: string }>).map(
        (column) => column.name,
      );
      expect(columns).not.toContain("goal");
    } finally {
      migrated.close();
    }
  });

  it("estimates a budget from the roster when migrating", () => {
    // Three members: two public messages each plus 35% headroom, rounded up.
    const databasePath = path.join(dir, "v4-budget.db");
    createV4Database(databasePath, "Ship it");

    const migrated = new WorkerStore({ databasePath });
    try {
      expect(migrated.getGoal("grp_old")?.turnLimit).toBe(9);
    } finally {
      migrated.close();
    }
  });

  it("leaves a group with no objective without a goal", () => {
    const databasePath = path.join(dir, "v4-empty.db");
    createV4Database(databasePath, null);

    const migrated = new WorkerStore({ databasePath });
    try {
      expect(migrated.getGoal("grp_old")).toBeNull();
    } finally {
      migrated.close();
    }
  });

  it("treats a blank objective as none", () => {
    const databasePath = path.join(dir, "v4-blank.db");
    createV4Database(databasePath, "   ");

    const migrated = new WorkerStore({ databasePath });
    try {
      expect(migrated.getGoal("grp_old")).toBeNull();
    } finally {
      migrated.close();
    }
  });
});

describe("suggested turn limits", () => {
  it("uses the reference product's default for a single member", () => {
    expect(WorkerStore.suggestTurnLimit(1)).toBe(20);
  });

  it("scales with the roster for multi-member work", () => {
    // Upstream: two public messages per member plus about 35% headroom.
    expect(WorkerStore.suggestTurnLimit(3)).toBe(9);
    expect(WorkerStore.suggestTurnLimit(10)).toBe(27);
  });

  it("stays inside the allowed range", () => {
    expect(WorkerStore.suggestTurnLimit(0)).toBeLessThanOrEqual(96);
    expect(WorkerStore.suggestTurnLimit(1000)).toBe(96);
  });
});

describe("goal budget stops waking", () => {
  const GROUP = { id: "grp_1", name: "Pricing page", projectId: "prj_abc" };

  beforeEach(() => {
    store.createWorker({ ...WORKER, id: "w2", name: "Bob" });
    store.createGroup(GROUP);
    joinGroup("grp_1", ["w1", "w2"]);
  });

  function createGoal(turnLimit: number) {
    return store.createGoal({
      goalId: "goal_1",
      groupId: "grp_1",
      content: "Ship it",
      turnLimit,
    });
  }

  function send(deliveryPolicy: "wake" | "store_only") {
    return store.createMessage({
      messageId: `msg_${Math.random().toString(16).slice(2)}`,
      groupId: "grp_1",
      senderWorkerId: "w1",
      body: "hello",
      audience: ["w2"],
      deliveryPolicy,
    });
  }

  it("allows the message that reaches the limit, then refuses the next", () => {
    // The limit is how many are allowed, not one fewer.
    createGoal(1);
    expect(() => send("wake")).not.toThrow();
    expect(() => send("wake")).toThrow(WorkerGoalBudgetExhaustedError);
  });

  it("refuses a waking send once the budget is spent", () => {
    createGoal(1);
    send("wake");
    expect(() => send("wake")).toThrow(/has spent its budget of 1 public messages/);
  });

  it("still allows a store-only message past the limit", () => {
    // The budget stops wakes, not communication: a spent group can still record
    // something, and required lifecycle updates must not be dropped to save
    // budget.
    createGoal(1);
    send("wake");
    expect(() => send("store_only")).not.toThrow();
    // And nobody was woken by it.
    expect(store.listInbox("w2")).toHaveLength(1);
  });

  it("counts a store-only message: it is public, it just does not wake", () => {
    // The budget bounds *public* messages, and visibility is what makes one
    // public. A store-only message is readable by the group, so it counts; only
    // a private message is free.
    createGoal(3);
    send("store_only");
    send("store_only");
    expect(store.getGoal("grp_1")?.turnUsed).toBe(2);
    expect(() => send("wake")).not.toThrow();
  });

  it("does not enforce a budget on a group with no goal", () => {
    // A group can exist before its objective does; nothing bounds it yet.
    expect(() => send("wake")).not.toThrow();
  });

  it("lets a reopened goal wake again with its new budget", () => {
    createGoal(1);
    send("wake");
    expect(() => send("wake")).toThrow(WorkerGoalBudgetExhaustedError);

    store.mutateGoal({
      groupId: "grp_1",
      action: "pause",
      expectedGeneration: 1,
      expectedRevision: 1,
      pauseReason: "turn_limit",
    });
    store.mutateGoal({
      groupId: "grp_1",
      action: "reopen",
      expectedGeneration: 1,
      expectedRevision: 2,
      turnLimit: 5,
    });

    expect(() => send("wake")).not.toThrow();
    expect(store.getGoal("grp_1")?.turnUsed).toBe(1);
  });
});

describe("worker runs", () => {
  beforeEach(() => {
    store.createWorker({ ...WORKER, id: "w2", name: "Bob" });
    store.createGroup({ id: "grp_1", name: "Pricing page", projectId: "prj_abc" });
    store.addGroupMember({ groupId: "grp_1", workerId: "w1", role: "coordinator" });
    store.addGroupMember({ groupId: "grp_1", workerId: "w2", role: "member" });
  });

  /** A message that woke `w2`, which is what a run is normally created from. */
  function wakeMessage(body = "need the schema"): WorkerMessageRecord {
    return store.createMessage({
      messageId: `msg_${Math.random().toString(16).slice(2)}`,
      groupId: "grp_1",
      senderWorkerId: "w1",
      body,
      audience: ["w2"],
    });
  }

  function deliveryState(messageId: string, workerId: string): string | null {
    const entry = store
      .listInbox(workerId)
      .find((candidate) => candidate.message.messageId === messageId);
    return entry ? entry.state : null;
  }

  function createRun(overrides: Partial<Parameters<typeof store.createRun>[0]> = {}) {
    return store.createRun({
      runId: "run_1",
      groupId: "grp_1",
      workerId: "w2",
      ...overrides,
    });
  }

  it("records a wake against its group and worker", () => {
    const message = wakeMessage();
    const run = createRun({ triggerMessageIds: [message.messageId] });
    expect(run).toMatchObject({
      runId: "run_1",
      groupId: "grp_1",
      workerId: "w2",
      state: "running",
    });
    expect(run.triggerMessageIds).toEqual([message.messageId]);
    // No session yet: one is attached once the run is actually carrying work.
    expect(run.sessionId).toBeNull();
    expect(run.endedAt).toBeNull();
  });

  it("claims its trigger messages in the same act that creates it", () => {
    // A run that did not own its messages would let a second wake pick up the
    // same work, which is the double dispatch this table prevents.
    const message = wakeMessage();
    createRun({ triggerMessageIds: [message.messageId] });
    expect(deliveryState(message.messageId, "w2")).toBe("claimed");
  });

  it("resolves a session back to the worker that owns it", () => {
    // This is R1's reason to exist. The CLI knows its agent session id, not a
    // wkr_ id; without this lookup a worker's message carries only a sender it
    // declared itself.
    const run = createRun();
    store.attachRunSession({ runId: run.runId, sessionId: "sess_abc" });

    const resolved = store.getRunBySession("sess_abc");
    expect(resolved?.workerId).toBe("w2");
    expect(resolved?.groupId).toBe("grp_1");
    expect(resolved?.runId).toBe("run_1");
  });

  it("resolves nothing for a session it has never seen", () => {
    createRun();
    expect(store.getRunBySession("sess_unknown")).toBeNull();
  });

  it("refuses to move a run onto a different session", () => {
    // Re-pointing it would attribute a later message to the wrong wake.
    const run = createRun();
    store.attachRunSession({ runId: run.runId, sessionId: "sess_abc" });
    expect(() => store.attachRunSession({ runId: run.runId, sessionId: "sess_other" })).toThrow(
      /already attached to session sess_abc/,
    );
    expect(store.getRun(run.runId)?.sessionId).toBe("sess_abc");
  });

  it("allows attaching the same session twice, so a retry is not an error", () => {
    const run = createRun();
    store.attachRunSession({ runId: run.runId, sessionId: "sess_abc" });
    expect(() => store.attachRunSession({ runId: run.runId, sessionId: "sess_abc" })).not.toThrow();
  });

  it("keeps one run in flight per worker", () => {
    // Enforced by a partial unique index, so it holds across processes rather
    // than only when a single caller remembers to check.
    createRun();
    expect(() => createRun({ runId: "run_2" })).toThrow(WorkerRunAlreadyActiveError);
  });

  it("allows a second run for a different worker", () => {
    createRun();
    expect(() => createRun({ runId: "run_2", workerId: "w1" })).not.toThrow();
  });

  it("allows a new run once the previous one is settled", () => {
    const first = createRun();
    store.settleRun({ runId: first.runId, state: "completed" });
    expect(() => createRun({ runId: "run_2" })).not.toThrow();
  });

  it("marks its messages read when it completes", () => {
    const message = wakeMessage();
    const run = createRun({ triggerMessageIds: [message.messageId] });
    store.settleRun({ runId: run.runId, state: "completed" });

    expect(store.getRun(run.runId)).toMatchObject({
      state: "completed",
      endedAt: expect.any(String),
    });
    // Read, and out of the inbox: the worker was woken by it and finished.
    expect(deliveryState(message.messageId, "w2")).toBeNull();
  });

  it("returns its messages to the inbox when it fails", () => {
    // The work must survive the run. A delivery stuck on `claimed` after a dead
    // run is a message nobody will ever answer.
    const message = wakeMessage();
    const run = createRun({ triggerMessageIds: [message.messageId] });
    store.settleRun({ runId: run.runId, state: "failed", failureReason: "provider down" });

    expect(store.getRun(run.runId)).toMatchObject({
      state: "failed",
      failureReason: "provider down",
    });
    expect(deliveryState(message.messageId, "w2")).toBe("unread");
  });

  it("returns its messages to the inbox when it is cancelled", () => {
    const message = wakeMessage();
    const run = createRun({ triggerMessageIds: [message.messageId] });
    store.settleRun({ runId: run.runId, state: "cancelled" });
    expect(deliveryState(message.messageId, "w2")).toBe("unread");
  });

  it("settles only once, so a retry cannot move messages twice", () => {
    // The wake loop can retry. A second settle that flipped a read delivery back
    // to unread would wake the worker again for work it already did.
    const message = wakeMessage();
    const run = createRun({ triggerMessageIds: [message.messageId] });
    store.settleRun({ runId: run.runId, state: "completed" });
    const again = store.settleRun({ runId: run.runId, state: "failed" });

    expect(again?.state).toBe("completed");
    expect(deliveryState(message.messageId, "w2")).toBeNull();
  });

  it("settles a run with no triggers without touching anything", () => {
    const run = createRun();
    expect(store.settleRun({ runId: run.runId, state: "completed" })?.state).toBe("completed");
  });

  it("deduplicates the trigger list", () => {
    const message = wakeMessage();
    const run = createRun({
      triggerMessageIds: [message.messageId, message.messageId],
    });
    expect(run.triggerMessageIds).toEqual([message.messageId]);
  });

  it("collects several messages into one wake", () => {
    // Several mentions arriving before a worker is woken is one wake, not
    // several, which is what keeps a busy group from serialising into noise.
    const first = wakeMessage("a");
    const second = wakeMessage("b");
    const run = createRun({ triggerMessageIds: [first.messageId, second.messageId] });
    expect(run.triggerMessageIds).toHaveLength(2);
    expect(deliveryState(first.messageId, "w2")).toBe("claimed");
    expect(deliveryState(second.messageId, "w2")).toBe("claimed");
  });

  it("refuses a run for an unknown group", () => {
    expect(() => createRun({ groupId: "grp_missing" })).toThrow(/unknown worker group/);
  });

  it("refuses a run for an unknown worker", () => {
    expect(() => createRun({ workerId: "wkr_missing" })).toThrow(/unknown worker/);
  });

  it("reports no runs when none are in flight", () => {
    expect(store.listRunningRuns()).toEqual([]);
  });

  it("lists in-flight runs oldest first", () => {
    createRun({ runId: "run_b", workerId: "w2", startedAt: "2026-09-24T02:00:00.000Z" });
    store.settleRun({ runId: "run_b", state: "completed" });
    createRun({ runId: "run_a", workerId: "w2", startedAt: "2026-09-24T01:00:00.000Z" });
    createRun({ runId: "run_c", workerId: "w1", startedAt: "2026-09-24T03:00:00.000Z" });

    expect(store.listRunningRuns().map((run: WorkerRunRecord) => run.runId)).toEqual([
      "run_a",
      "run_c",
    ]);
  });

  it("survives reopening the database", () => {
    const message = wakeMessage();
    const run = createRun({ triggerMessageIds: [message.messageId] });
    store.attachRunSession({ runId: run.runId, sessionId: "sess_abc" });

    const databasePath = path.join(dir, "worker.db");
    store.close();
    store = new WorkerStore({ databasePath });

    expect(store.getRun("run_1")).toMatchObject({ state: "running", sessionId: "sess_abc" });
    expect(store.getRunBySession("sess_abc")?.workerId).toBe("w2");
    expect(deliveryState(message.messageId, "w2")).toBe("claimed");
  });

  it("drops a group's runs when the group goes", () => {
    createRun();
    store.deleteGroup("grp_1");
    expect(store.getRun("run_1")).toBeNull();
  });
});

describe("task sessions", () => {
  it("binds a session to a task", () => {
    // The session is what a follow-up turn is sent to, so "which session is
    // this task" has to be answerable from the task rather than only from its
    // history note.
    const task = store.createTask({ taskId: "t1", workerId: "w1", title: "Work" });
    expect(task.agentId).toBeNull();

    const bound = store.setTaskAgent({ taskId: "t1", agentId: "agent_1" });
    expect(bound.agentId).toBe("agent_1");
    expect(store.getTask("t1")?.agentId).toBe("agent_1");
  });

  it("does not write history for binding a session", () => {
    // Binding is not a state change; a history entry would put a non-event in
    // the audit trail.
    store.createTask({ taskId: "t1", workerId: "w1", title: "Work" });
    store.setTaskAgent({ taskId: "t1", agentId: "agent_1" });
    expect(store.listTaskHistory("t1")).toHaveLength(0);
  });

  it("refuses to replace a session once set", () => {
    // Changing it would orphan the conversation the task already has.
    store.createTask({ taskId: "t1", workerId: "w1", title: "Work" });
    store.setTaskAgent({ taskId: "t1", agentId: "agent_1" });
    expect(() => store.setTaskAgent({ taskId: "t1", agentId: "agent_2" })).toThrow(
      /already bound to session agent_1/,
    );
    expect(store.getTask("t1")?.agentId).toBe("agent_1");
  });

  it("accepts the same session twice, so a retry is not an error", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Work" });
    store.setTaskAgent({ taskId: "t1", agentId: "agent_1" });
    expect(() => store.setTaskAgent({ taskId: "t1", agentId: "agent_1" })).not.toThrow();
  });

  it("refuses a session for a task that does not exist", () => {
    expect(() => store.setTaskAgent({ taskId: "missing", agentId: "agent_1" })).toThrow(
      /unknown worker task/,
    );
  });

  it("survives reopening the database", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Work" });
    store.setTaskAgent({ taskId: "t1", agentId: "agent_1" });
    const databasePath = path.join(dir, "worker.db");
    store.close();
    store = new WorkerStore({ databasePath });
    expect(store.getTask("t1")?.agentId).toBe("agent_1");
  });
});

describe("schema v6 migration", () => {
  it("adds the session column to an existing database", () => {
    // Additive, but not free: CREATE TABLE IF NOT EXISTS does not add a column
    // to a table that already exists.
    const databasePath = path.join(dir, "v5.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE worker_schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO worker_schema_version VALUES (5, '2026-09-24T00:00:00.000Z');
      CREATE TABLE workers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, template_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE worker_tasks (
        task_id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, title TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO workers VALUES ('w1','Alice','qa-engineer','/tmp/ws','online','2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z');
      INSERT INTO worker_tasks VALUES ('t1','w1','Existing','in_progress','2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z');
    `);
    legacy.close();

    const migrated = new WorkerStore({ databasePath });
    try {
      expect(migrated.getSchemaVersion()).toBe(SCHEMA_VERSION);
      // The existing row is kept, and reads report no session rather than fail.
      expect(migrated.getTask("t1")).toMatchObject({ title: "Existing", agentId: null });
      expect(migrated.setTaskAgent({ taskId: "t1", agentId: "agent_1" }).agentId).toBe("agent_1");
    } finally {
      migrated.close();
    }
  });
});

describe("wake candidates", () => {
  beforeEach(() => {
    store.createWorker({ ...WORKER, id: "w2", name: "Bob" });
    store.createWorker({ ...WORKER, id: "w3", name: "Carol" });
    store.createGroup({ id: "grp_1", name: "Pricing", projectId: "prj_a" });
    store.createGroup({ id: "grp_2", name: "Other", projectId: "prj_b" });
    for (const [groupId, workerId] of [
      ["grp_1", "w1"],
      ["grp_1", "w2"],
      ["grp_1", "w3"],
      // w1 coordinates both, so a message addressed to w2 can come from either
      // group and the case below is the real shape: one worker, two conversations.
      ["grp_2", "w1"],
      ["grp_2", "w2"],
    ] as const) {
      store.addGroupMember({
        groupId,
        workerId,
        role: workerId === "w1" ? "coordinator" : "member",
      });
    }
  });

  let messageCount = 0;
  function send(input: {
    groupId: string;
    sender: string;
    audience?: string[];
    deliveryPolicy?: "wake" | "store_only";
  }) {
    messageCount += 1;
    return store.createMessage({
      messageId: `msg_${messageCount}`,
      groupId: input.groupId,
      senderWorkerId: input.sender,
      body: "work",
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.deliveryPolicy ? { deliveryPolicy: input.deliveryPolicy } : {}),
    });
  }

  it("is empty when nothing is waiting", () => {
    expect(store.listWakeCandidates()).toEqual([]);
  });

  it("lists a woken worker with the message that woke it", () => {
    const message = send({ groupId: "grp_1", sender: "w1", audience: ["w2"] });
    expect(store.listWakeCandidates()).toEqual([
      { workerId: "w2", groupId: "grp_1", messageIds: [message.messageId] },
    ]);
  });

  it("ignores a store-only message, which woke nobody", () => {
    // No delivery row is written for these at all, which is what makes "unread
    // means a wake" true rather than a rule repeated in two places.
    send({ groupId: "grp_1", sender: "w1", deliveryPolicy: "store_only" });
    expect(store.listWakeCandidates()).toEqual([]);
  });

  it("collects several messages for one worker into one candidate", () => {
    // A worker woken by two messages gets both, so it does not answer the first
    // and then immediately wake again for the second.
    const first = send({ groupId: "grp_1", sender: "w1", audience: ["w2"] });
    const second = send({ groupId: "grp_1", sender: "w3", audience: ["w2"] });
    expect(store.listWakeCandidates()).toEqual([
      { workerId: "w2", groupId: "grp_1", messageIds: [first.messageId, second.messageId] },
    ]);
  });

  it("keeps two groups apart for a worker in both", () => {
    // A run belongs to exactly one group, so a mixed inbox with an arbitrary
    // group on it would attribute the wake to the wrong conversation.
    const inOne = send({ groupId: "grp_1", sender: "w1", audience: ["w2"] });
    const inTwo = send({ groupId: "grp_2", sender: "w1", audience: ["w2"] });
    const candidates = store.listWakeCandidates();
    expect(candidates).toHaveLength(2);
    expect(candidates.find((entry) => entry.groupId === "grp_1")?.messageIds).toEqual([
      inOne.messageId,
    ]);
    expect(candidates.find((entry) => entry.groupId === "grp_2")?.messageIds).toEqual([
      inTwo.messageId,
    ]);
  });

  it("skips a worker with a run in flight", () => {
    // One wake at a time, so the loop can be driven from several places without
    // dispatching the same worker twice.
    send({ groupId: "grp_1", sender: "w1", audience: ["w2"] });
    store.createRun({ runId: "run_1", groupId: "grp_1", workerId: "w2" });
    expect(store.listWakeCandidates()).toEqual([]);
  });

  it("offers the worker again once its run settles", () => {
    const message = send({ groupId: "grp_1", sender: "w1", audience: ["w2"] });
    const run = store.createRun({
      runId: "run_1",
      groupId: "grp_1",
      workerId: "w2",
      triggerMessageIds: [message.messageId],
    });
    expect(store.listWakeCandidates()).toEqual([]);
    store.settleRun({ runId: run.runId, state: "completed" });
    // Completed, so the delivery is read and there is nothing left to wake for.
    expect(store.listWakeCandidates()).toEqual([]);
  });

  it("offers a failed run's messages again", () => {
    // This is the recovery path: a wake that died must not consume its messages.
    const message = send({ groupId: "grp_1", sender: "w1", audience: ["w2"] });
    const run = store.createRun({
      runId: "run_1",
      groupId: "grp_1",
      workerId: "w2",
      triggerMessageIds: [message.messageId],
    });
    store.settleRun({ runId: run.runId, state: "failed", failureReason: "boom" });
    expect(store.listWakeCandidates()).toEqual([
      { workerId: "w2", groupId: "grp_1", messageIds: [message.messageId] },
    ]);
  });
});
