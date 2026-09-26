/**
 * Tests for running a task through the service.
 *
 * The runner is faked but the store is real: what matters here is that a run
 * leaves the task in the right state and that every state change is in the
 * history, and that is only meaningful against the real transition writer.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkerBusyError,
  WorkerGroupNotFoundError,
  WorkerRunUnavailableError,
  WorkerService,
} from "./service.js";
import type { WorkerRunner } from "./worker-runner.js";

const silentLogger = pino({ level: "silent" });

function captureError(run: () => unknown): Error | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "worker-run-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function createService(runner?: Partial<WorkerRunner>): WorkerService {
  return new WorkerService({
    byspaceHome: home,
    logger: silentLogger,
    runner: runner as WorkerRunner | undefined,
  });
}

/**
 * Creating a worker also creates its workspace on disk, so the test needs a
 * writable path rather than a stand-in like `/repo`.
 */
async function seedTask(service: WorkerService): Promise<{ taskId: string; workspace: string }> {
  const workspace = join(home, "repo");
  const worker = await service.createWorker({
    name: "Alice",
    templateId: "frontend-developer",
    workspacePath: workspace,
  });
  const task = service.createTask({
    workerId: worker.id,
    title: "Build the pricing table",
  });
  return { taskId: task.taskId, workspace };
}

describe("worker service runTask", () => {
  it("runs the task and records in_progress then submitted", async () => {
    const run = vi.fn(async () => ({ kind: "submitted" as const, agentId: "agent_1" }));
    const service = createService({ run });
    const { taskId } = await seedTask(service);

    const task = await service.runTask(taskId);

    expect(task.state).toBe("submitted");
    // Creation establishes `assigned`; the history holds transitions only.
    expect(service.taskHistory(taskId).map((entry) => entry.toState)).toEqual([
      "in_progress",
      "submitted",
    ]);
  });

  it("attributes every state change to the worker that ran it", async () => {
    // The history is the audit trail; an unattributed run would make it
    // impossible to tell which worker did the work.
    const run = vi.fn(async () => ({ kind: "submitted" as const, agentId: "agent_1" }));
    const service = createService({ run });
    const { taskId } = await seedTask(service);

    await service.runTask(taskId);

    const actors = service.taskHistory(taskId).map((entry) => entry.actor);
    expect(actors).toHaveLength(2);
    for (const actor of actors) {
      expect(actor).toMatch(/^worker:wkr_[0-9a-f]+$/);
    }
    expect(actors[0]).toBe(actors[1]);
  });

  it("keeps the agent id in the history so a run can be found later", async () => {
    const run = vi.fn(async () => ({ kind: "submitted" as const, agentId: "agent_42" }));
    const service = createService({ run });
    const { taskId } = await seedTask(service);

    await service.runTask(taskId);

    const submitted = service.taskHistory(taskId).at(-1);
    expect(submitted?.note).toBe("agent_42");
  });

  it("records a blocked outcome as blocked, with the reason", async () => {
    const run = vi.fn(async () => ({
      kind: "blocked" as const,
      agentId: "agent_1",
      reason: "the worker is waiting for a permission decision",
    }));
    const service = createService({ run });
    const { taskId } = await seedTask(service);

    const task = await service.runTask(taskId);

    expect(task.state).toBe("blocked");
    expect(service.taskHistory(taskId).at(-1)?.note).toContain("permission");
  });

  it("records a failed outcome as blocked rather than losing the task", async () => {
    // A failure is a person's problem to resolve, so the task stays visible in
    // a state that asks for attention instead of vanishing.
    const run = vi.fn(async () => ({
      kind: "failed" as const,
      agentId: null,
      reason: "provider unavailable",
    }));
    const service = createService({ run });
    const { taskId } = await seedTask(service);

    const task = await service.runTask(taskId);

    expect(task.state).toBe("blocked");
    expect(service.taskHistory(taskId).at(-1)?.note).toBe("provider unavailable");
  });

  it("hands the runner the worker's own workspace and role", async () => {
    const run = vi.fn(async () => ({ kind: "submitted" as const, agentId: "agent_1" }));
    const service = createService({ run });
    const { taskId, workspace } = await seedTask(service);

    await service.runTask(taskId);

    const input = run.mock.calls[0]?.[0] as {
      workerId: string;
      workspacePath: string;
      template: { id: string; parts: Record<string, string> };
    };
    expect(input.workerId).toMatch(/^wkr_[0-9a-f]+$/);
    expect(input.workspacePath).toBe(workspace);
    expect(input.template.id).toBe("frontend-developer");
    expect(Object.keys(input.template.parts).length).toBeGreaterThan(0);
  });

  it("refuses a second run while one is already in flight", async () => {
    // A worker has one workspace, so two runs would be two sessions in the same
    // directory and neither result could be attributed cleanly. The bound is
    // also what makes "the same work is not handed out twice" true rather than
    // merely intended.
    let release: (() => void) | null = null;
    const run = vi.fn(
      () =>
        new Promise<{ kind: "submitted"; agentId: string }>((resolve) => {
          release = () => resolve({ kind: "submitted", agentId: "agent_1" });
        }),
    );
    const service = createService({ run });
    const { taskId: first } = await seedTask(service);
    const workerId = service.getTask(first).workerId;
    const second = service.createTask({ workerId, title: "A second task" });

    const inFlight = service.runTask(first);
    // Let the first run reach the point where it has acknowledged the task.
    await vi.waitFor(() => expect(service.getTask(first).state).toBe("in_progress"));

    await expect(service.runTask(second.taskId)).rejects.toThrow(WorkerBusyError);
    // The refused task is untouched: it must not be acknowledged then abandoned.
    expect(service.getTask(second.taskId).state).toBe("planned");

    release?.();
    await expect(inFlight).resolves.toMatchObject({ state: "submitted" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("allows the next run once the previous one settles", async () => {
    const run = vi.fn(async () => ({ kind: "submitted" as const, agentId: "agent_1" }));
    const service = createService({ run });
    const { taskId: first } = await seedTask(service);
    const workerId = service.getTask(first).workerId;
    const second = service.createTask({ workerId, title: "A second task" });
    await service.runTask(first);

    await expect(service.runTask(second.taskId)).resolves.toMatchObject({ state: "submitted" });
  });

  it("refuses clearly when the daemon has no runner", async () => {
    const service = createService();
    const { taskId } = await seedTask(service);

    await expect(service.runTask(taskId)).rejects.toThrow(WorkerRunUnavailableError);
    // The task is untouched: a refusal must not half-apply the ack.
    expect(service.getTask(taskId).state).toBe("planned");
  });

  it("does not run a task that has already been submitted", async () => {
    const run = vi.fn(async () => ({ kind: "submitted" as const, agentId: "agent_1" }));
    const service = createService({ run });
    const { taskId } = await seedTask(service);
    await service.runTask(taskId);

    await expect(service.runTask(taskId)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("worker service messages", () => {
  async function seedGroup(service: WorkerService): Promise<{ groupId: string; alice: string }> {
    const alice = await service.createWorker({
      name: "Alice",
      templateId: "project-administrator",
      workspacePath: join(home, "alice"),
    });
    const bob = await service.createWorker({
      name: "Bob",
      templateId: "backend-engineer",
      workspacePath: join(home, "bob"),
    });
    const group = service.createGroup({
      name: "Pricing page",
      projectId: "prj_1",
      coordinatorWorkerId: alice.id,
      memberWorkerIds: [bob.id],
    });
    return { groupId: group.id, alice: alice.id };
  }

  it("sends a message and reports who it woke", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    const members = service.listGroupMembers(groupId);
    const bob = members.find((member) => member.workerId !== alice)!.workerId;

    const { message, woke } = service.sendMessage({
      groupId,
      senderWorkerId: alice,
      body: "Please take the API side",
      audience: [bob],
    });

    expect(message.seq).toBe(1);
    expect(woke).toEqual([bob]);
    expect(message.intent).toBe("request_action");
  });

  it("reports nobody woken when a waking send addresses nobody", async () => {
    // This is why `woke` is returned rather than inferred: the message alone
    // cannot distinguish this from a send that reached someone.
    const service = createService();
    const { groupId, alice } = await seedGroup(service);

    const { message, woke } = service.sendMessage({
      groupId,
      senderWorkerId: alice,
      body: "Nobody in particular",
      deliveryPolicy: "wake",
    });

    expect(woke).toEqual([]);
    expect(message.deliveryPolicy).toBe("wake");
  });

  it("surfaces the message in the addressee's inbox, not the sender's", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    const bob = service
      .listGroupMembers(groupId)
      .find((member) => member.workerId !== alice)!.workerId;

    service.sendMessage({ groupId, senderWorkerId: alice, body: "task", audience: [bob] });

    expect(service.listInbox(bob)).toHaveLength(1);
    expect(service.listInbox(alice)).toHaveLength(0);
  });

  it("does not wake the addressee for a store-only message", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    const bob = service
      .listGroupMembers(groupId)
      .find((member) => member.workerId !== alice)!.workerId;

    service.sendMessage({
      groupId,
      senderWorkerId: alice,
      body: "for the record",
      audience: [bob],
      deliveryPolicy: "store_only",
    });

    expect(service.listInbox(bob)).toHaveLength(0);
    expect(service.listMessages({ groupId })).toHaveLength(1);
  });

  it("refuses a message on an unknown group", async () => {
    const service = createService();
    const { alice } = await seedGroup(service);
    expect(() =>
      service.sendMessage({ groupId: "grp_missing", senderWorkerId: alice, body: "hi" }),
    ).toThrow(/Unknown worker group/);
  });

  it("marks a delivery and drops it from the inbox", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    const bob = service
      .listGroupMembers(groupId)
      .find((member) => member.workerId !== alice)!.workerId;
    const { message } = service.sendMessage({
      groupId,
      senderWorkerId: alice,
      body: "task",
      audience: [bob],
    });

    expect(
      service.markMessageDelivery({ messageId: message.messageId, workerId: bob, state: "read" }),
    ).toBe(true);
    expect(service.listInbox(bob)).toHaveLength(0);
  });

  it("reports false rather than throwing when a worker was not addressed", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    const { message } = service.sendMessage({
      groupId,
      senderWorkerId: alice,
      body: "private to me",
    });

    expect(
      service.markMessageDelivery({ messageId: message.messageId, workerId: alice, state: "read" }),
    ).toBe(false);
  });

  it("filters the stream to a viewer, so a private message stays private", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    const bob = service
      .listGroupMembers(groupId)
      .find((member) => member.workerId !== alice)!.workerId;
    const carol = await service.createWorker({
      name: "Carol",
      templateId: "qa-engineer",
      workspacePath: join(home, "carol"),
    });

    service.sendMessage({
      groupId,
      senderWorkerId: alice,
      body: "just between us",
      audience: [bob],
      privateTo: [bob],
    });

    expect(service.listMessages({ groupId, viewerWorkerId: bob })).toHaveLength(1);
    expect(service.listMessages({ groupId, viewerWorkerId: carol.id })).toHaveLength(0);
  });
});

describe("worker service goals", () => {
  async function seedGroup(service: WorkerService) {
    const alice = await service.createWorker({
      name: "Alice",
      templateId: "project-administrator",
      workspacePath: join(home, "alice"),
    });
    const group = service.createGroup({
      name: "Pricing page",
      projectId: "prj_1",
      coordinatorWorkerId: alice.id,
    });
    return { groupId: group.id, alice: alice.id };
  }

  it("creates a goal and reads it back", async () => {
    const service = createService();
    const { groupId } = await seedGroup(service);

    service.createGoal({ groupId, content: "Ship the pricing page", turnLimit: 20 });

    expect(service.getGoal(groupId)).toMatchObject({
      content: "Ship the pricing page",
      status: "active",
      generation: 1,
      revision: 1,
      turnUsed: 0,
    });
  });

  it("reports no goal rather than throwing for a group that has none", async () => {
    // A group exists before its goal does, so this is a normal state.
    const service = createService();
    const { groupId } = await seedGroup(service);
    expect(service.getGoal(groupId)).toBeNull();
  });

  it("refuses a goal on an unknown group", async () => {
    const service = createService();
    await seedGroup(service);
    expect(() =>
      service.createGoal({ groupId: "grp_missing", content: "x", turnLimit: 5 }),
    ).toThrow(/Unknown worker group/);
  });

  it("counts only public messages against the budget", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    service.createGoal({ groupId, content: "Ship it", turnLimit: 20 });

    service.sendMessage({ groupId, senderWorkerId: alice, body: "public" });
    service.sendMessage({ groupId, senderWorkerId: alice, body: "private", privateTo: [alice] });

    expect(service.getGoal(groupId)?.turnUsed).toBe(1);
  });

  it("refuses a mutation written against a stale version", async () => {
    const service = createService();
    const { groupId } = await seedGroup(service);
    service.createGoal({ groupId, content: "Ship it", turnLimit: 20 });

    service.mutateGoal({
      groupId,
      action: "update",
      expectedGeneration: 1,
      expectedRevision: 1,
      content: "first wins",
    });

    expect(() =>
      service.mutateGoal({
        groupId,
        action: "update",
        expectedGeneration: 1,
        expectedRevision: 1,
        content: "stale writer",
      }),
    ).toThrow(/changed since it was read/);
    expect(service.getGoal(groupId)?.content).toBe("first wins");
  });

  it("completes a goal with the message that delivered it", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    service.createGoal({ groupId, content: "Ship it", turnLimit: 20 });
    const { message } = service.sendMessage({
      groupId,
      senderWorkerId: alice,
      body: "Here is the pricing page",
    });

    const goal = service.mutateGoal({
      groupId,
      action: "complete",
      expectedGeneration: 1,
      expectedRevision: 1,
      resultMessageId: message.messageId,
    });

    expect(goal).toMatchObject({ status: "completed", resultMessageId: message.messageId });
  });

  it("carries the goal forward on reopen with a fresh budget", async () => {
    const service = createService();
    const { groupId, alice } = await seedGroup(service);
    service.createGoal({ groupId, content: "Ship it", turnLimit: 20 });
    service.sendMessage({ groupId, senderWorkerId: alice, body: "public" });

    service.mutateGoal({
      groupId,
      action: "pause",
      expectedGeneration: 1,
      expectedRevision: 1,
      pauseReason: "awaiting_user",
    });
    const reopened = service.mutateGoal({
      groupId,
      action: "reopen",
      expectedGeneration: 1,
      expectedRevision: 2,
      content: "Ship it, second attempt",
    });

    expect(reopened).toMatchObject({
      content: "Ship it, second attempt",
      generation: 2,
      status: "active",
      turnUsed: 0,
    });
  });
});

describe("message sender resolution", () => {
  /** A group with two workers, so one can be named while the other speaks. */
  async function twoWorkers(service: WorkerService) {
    const alice = await service.createWorker({
      name: "Alice",
      templateId: "project-administrator",
      workspacePath: join(home, "alice"),
    });
    const bob = await service.createWorker({
      name: "Bob",
      templateId: "backend-engineer",
      workspacePath: join(home, "bob"),
    });
    const group = service.createGroup({
      name: "Pricing",
      projectId: "prj_a",
      coordinatorWorkerId: alice.id,
      memberWorkerIds: [bob.id],
    });
    return { alice, bob, group };
  }

  it("prefers the session over a matching worker id", async () => {
    const service = createService();
    const { bob, group } = await twoWorkers(service);
    const run = service.getStore().createRun({
      runId: "run_1",
      groupId: group.id,
      workerId: bob.id,
    });
    service.getStore().attachRunSession({ runId: run.runId, sessionId: "sess_bob" });

    expect(
      service.resolveMessageSender({ senderSessionId: "sess_bob", senderWorkerId: bob.id }),
    ).toBe(bob.id);
  });

  it("refuses a worker that names somebody else as the sender", async () => {
    // This is the case the whole identity model exists for. A worker could
    // previously claim any sender it liked; now the session is checked, and a
    // disagreement is refused rather than resolved in anyone's favour.
    const service = createService();
    const { alice, bob, group } = await twoWorkers(service);
    const run = service.getStore().createRun({
      runId: "run_1",
      groupId: group.id,
      workerId: bob.id,
    });
    service.getStore().attachRunSession({ runId: run.runId, sessionId: "sess_bob" });

    expect(() =>
      service.resolveMessageSender({ senderSessionId: "sess_bob", senderWorkerId: alice.id }),
    ).toThrow(/does not match the session's worker/);
  });

  it("refuses a session that no run or task authorises", () => {
    const service = createService();
    expect(() => service.resolveMessageSender({ senderSessionId: "sess_stranger" })).toThrow(
      /is not a worker run/,
    );
  });

  it("accepts a bare worker id from outside a session", async () => {
    // The console and an operator have no session; they name the worker. Only a
    // worker that claims to be in one is held to it.
    const service = createService();
    const { alice } = await twoWorkers(service);
    expect(service.resolveMessageSender({ senderWorkerId: alice.id })).toBe(alice.id);
  });

  it("refuses a send that names neither", () => {
    const service = createService();
    expect(() => service.resolveMessageSender({})).toThrow(/needs a sender/);
  });

  it("sends as the resolved worker, not the named one", async () => {
    // End to end through sendMessage: the message that lands must carry the
    // worker the session proves, whatever was asked for.
    const service = createService();
    const { bob, group } = await twoWorkers(service);
    const run = service.getStore().createRun({
      runId: "run_1",
      groupId: group.id,
      workerId: bob.id,
    });
    service.getStore().attachRunSession({ runId: run.runId, sessionId: "sess_bob" });

    const sender = service.resolveMessageSender({
      senderSessionId: "sess_bob",
      senderWorkerId: bob.id,
    });
    const { message } = service.sendMessage({
      groupId: group.id,
      senderWorkerId: sender,
      body: "reporting in",
    });
    expect(message.senderWorkerId).toBe(bob.id);
  });
});

describe("sender resolution from a run", () => {
  /** A group with a coordinator and a member who can be woken. */
  async function seeded(service: WorkerService) {
    const workspace = join(home, "repo");
    const alice = await service.createWorker({
      name: "Alice",
      templateId: "project-administrator",
      workspacePath: workspace,
    });
    const bob = await service.createWorker({
      name: "Bob",
      templateId: "backend-engineer",
      workspacePath: join(home, "repo-bob"),
    });
    const group = service.createGroup({
      name: "Pricing page",
      projectId: "prj_abc",
      coordinatorWorkerId: alice.id,
      memberWorkerIds: [bob.id],
    });
    return { alice, bob, group };
  }

  it("resolves a running session to the worker it speaks for", async () => {
    const service = createService();
    const { bob, group } = await seeded(service);

    const run = service.getStore().createRun({
      runId: "run_1",
      groupId: group.id,
      workerId: bob.id,
    });
    service.getStore().attachRunSession({ runId: run.runId, sessionId: "sess_bob" });

    expect(service.resolveSenderFromSession("sess_bob")).toEqual({
      workerId: bob.id,
      runId: "run_1",
    });
  });

  it("refuses a session with no run at all", () => {
    // The point of the check: an arbitrary agent id must not resolve to a worker.
    const service = createService();
    expect(() => service.resolveSenderFromSession("sess_stranger")).toThrow(
      /is not a worker run, so it cannot send as a worker/,
    );
  });

  it("refuses a session whose run has already finished", async () => {
    // A worker that is not awake has no business sending, and the run is what
    // says whether it is.
    const service = createService();
    const { bob, group } = await seeded(service);
    const run = service.getStore().createRun({
      runId: "run_1",
      groupId: group.id,
      workerId: bob.id,
    });
    service.getStore().attachRunSession({ runId: run.runId, sessionId: "sess_bob" });
    service.getStore().settleRun({ runId: "run_1", state: "completed" });

    expect(() => service.resolveSenderFromSession("sess_bob")).toThrow(
      /belongs to a completed run, which can no longer send/,
    );
  });

  it("resolves a session carrying an in-progress task", async () => {
    // A worker reporting into its group while doing assigned work has a session
    // and no run, so the task has to authorise it too.
    const service = createService();
    const { taskId } = await seedTask(service);
    const task = service.getStore().getTask(taskId)!;
    service.getStore().setTaskAgent({ taskId, agentId: "sess_task" });
    service.getStore().applyTaskTransition({
      taskId,
      toState: "in_progress",
      action: "ack_task",
      actor: "test",
    });

    expect(service.resolveSenderFromSession("sess_task")).toEqual({
      workerId: task.workerId,
      runId: null,
    });
  });

  it("refuses a task session whose task has finished", async () => {
    // The authority is current. A submitted task means the turn is over, so the
    // session may not keep sending on an id that is still valid.
    const service = createService();
    const { taskId } = await seedTask(service);
    service.getStore().setTaskAgent({ taskId, agentId: "sess_done" });
    service.getStore().applyTaskTransition({
      taskId,
      toState: "in_progress",
      action: "ack_task",
      actor: "test",
    });
    service.getStore().applyTaskTransition({
      taskId,
      toState: "submitted",
      action: "submit_task",
      actor: "test",
    });

    expect(() => service.resolveSenderFromSession("sess_done")).toThrow(
      /is not a worker run, so it cannot send as a worker/,
    );
  });

  it("refuses a run that has no session attached yet", async () => {
    // Resolution is by session id, so an unattached run must not answer to any.
    const service = createService();
    const { bob, group } = await seeded(service);
    service.getStore().createRun({ runId: "run_1", groupId: group.id, workerId: bob.id });
    expect(() => service.resolveSenderFromSession("")).toThrow(/is not a worker run/);
  });
});

describe("scoped reads", () => {
  /** A group and two sessions whose workers are and are not in it. */
  async function scoped(service: WorkerService) {
    const workspace = join(home, "repo");
    const alice = await service.createWorker({
      name: "Alice",
      templateId: "frontend-developer",
      workspacePath: workspace,
    });
    const bob = await service.createWorker({
      name: "Bob",
      templateId: "backend-engineer",
      workspacePath: join(home, "repo-b"),
    });
    const group = service.createGroup({
      name: "Scoped",
      projectId: "prj_s",
      coordinatorWorkerId: alice.id,
      memberWorkerIds: [],
    });
    // Alice is in the group; Bob is not. One task session for each, so both
    // have a resolvable identity.
    const taskIn = service.createTask({ workerId: alice.id, title: "in" });
    const taskOut = service.createTask({ workerId: bob.id, title: "out" });
    service.runTasklessTransitionForTests?.(taskIn.taskId);
    service.getStore().setTaskAgent({ taskId: taskIn.taskId, agentId: "sess_in" });
    service.getStore().setTaskAgent({ taskId: taskOut.taskId, agentId: "sess_out" });
    service.getStore().applyTaskTransition({
      taskId: taskIn.taskId,
      toState: "in_progress",
      action: "ack_task",
      actor: "test",
    });
    service.getStore().applyTaskTransition({
      taskId: taskOut.taskId,
      toState: "in_progress",
      action: "ack_task",
      actor: "test",
    });
    return { alice, bob, group, inTask: taskIn.taskId, outTask: taskOut.taskId };
  }

  it("refuses a non-member stream read exactly as an unknown group", async () => {
    // The indistinguishability is the rule: a caller probing group ids cannot
    // tell "does not exist" from "exists but is not yours".
    const service = createService();
    const { group } = await scoped(service);

    const member = service.listMessages({ groupId: group.id, viewerSessionId: "sess_in" });
    expect(member).toEqual([]);

    const outsider = () => service.listMessages({ groupId: group.id, viewerSessionId: "sess_out" });
    expect(outsider).toThrow(/Unknown worker group/);

    // Indistinguishable means: for the SAME id, a non-member read and an
    // unknown group produce identical messages. Same class, same wording —
    // sharing the class is what keeps them identical as wording evolves.
    const sameIdAsOutsider = () =>
      service.listMessages({ groupId: "grp_missing", viewerSessionId: "sess_out" });
    const nonexistent = () =>
      service.listMessages({ groupId: "grp_missing", viewerSessionId: "sess_in" });
    const refusedAsOutsider = captureError(sameIdAsOutsider);
    const refusedAsMissing = captureError(nonexistent);
    expect(refusedAsOutsider?.message).toBe(refusedAsMissing?.message);
    expect(refusedAsMissing).toBeInstanceOf(WorkerGroupNotFoundError);
  });

  it("refuses a viewer that names somebody else", async () => {
    // Same rule the send path established: a disagreement between the session
    // and the declared worker is refused, not overruled.
    const service = createService();
    const { group, alice } = await scoped(service);
    expect(() =>
      service.listMessages({
        groupId: group.id,
        viewerSessionId: "sess_in",
        viewerWorkerId: "wkr_somebody_else",
      }),
    ).toThrow(/does not match the session's worker/);
    expect(alice.id).toContain("wkr_");
  });

  it("refuses a session that is not a worker's", async () => {
    const service = createService();
    const { group } = await scoped(service);
    expect(() =>
      service.listMessages({ groupId: group.id, viewerSessionId: "sess_stranger" }),
    ).toThrow(/is not a worker run, so it cannot send as a worker/);
  });

  it("keeps the operator view when no session is given", async () => {
    const service = createService();
    const { group } = await scoped(service);
    // No viewer session: reads everything, which is what the console does.
    expect(service.listMessages({ groupId: group.id })).toEqual([]);
    expect(service.getGoal(group.id)).toBeNull();
  });

  it("scopes an inbox read to the session's own worker", async () => {
    const service = createService();
    const { alice } = await scoped(service);
    // Another worker's queue reads as though that worker did not exist.
    expect(() => service.listInbox(alice.id, "sess_out")).toThrow(/unknown worker/);
    expect(() => service.listInbox(alice.id, "sess_in")).not.toThrow();
    // The operator still reads any queue.
    expect(() => service.listInbox(alice.id)).not.toThrow();
  });

  it("scopes a goal read by membership, with the same wording", async () => {
    const service = createService();
    const { group } = await scoped(service);
    expect(() => service.getGoal(group.id, "sess_out")).toThrow(/Unknown worker group/);
    expect(service.getGoal(group.id, "sess_in")).toBeNull();
  });
});
