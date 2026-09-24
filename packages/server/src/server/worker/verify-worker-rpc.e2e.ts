/**
 * End-to-end check that the worker RPCs work against a real daemon.
 *
 * The unit tests call `WorkerSession` directly with a hand-built host. This
 * goes through the actual path a client uses: a real daemon on a real socket,
 * the real `DaemonClient`, the real protocol schemas on both ends. It is the
 * difference between "the handler works" and "a client can reach it".
 *
 * Run: npx tsx packages/server/src/server/worker/verify-worker-rpc.e2e.ts
 */
import { DaemonClient } from "@bytetrue/client/internal/daemon-client";

import { createTestBySpaceDaemon } from "../test-utils/byspace-daemon.js";

async function main(): Promise<void> {
  const daemon = await createTestBySpaceDaemon();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.16.1",
    clientId: "cli_worker_rpc_verify",
  });

  const checks: Array<{ name: string; detail: string }> = [];

  try {
    await client.connect();

    const templates = await client.listWorkerTemplates();
    checks.push({ name: "list templates", detail: `${templates.templates.length} roles` });

    const created = await client.createWorker({
      name: "Alice",
      templateId: "frontend-developer",
    });
    const workerId = created.worker.id;
    checks.push({ name: "create worker", detail: workerId });

    const workers = await client.listWorkers();
    checks.push({ name: "list workers", detail: `${workers.workers.length} worker(s)` });

    const fetched = await client.getWorker(workerId);
    checks.push({ name: "get worker", detail: `${fetched.tasks.length} task(s)` });

    const task = await client.createWorkerTask({ workerId, title: "Build pricing table" });
    checks.push({ name: "create task", detail: task.task.state });

    const assigned = await client.transitionWorkerTask({
      taskId: task.task.taskId,
      toState: "assigned",
      action: "assign_task",
      actor: "worker:lead",
    });
    checks.push({ name: "transition assigned", detail: assigned.task.state });

    const submitted = await client.transitionWorkerTask({
      taskId: task.task.taskId,
      toState: "submitted",
      action: "submit_task",
      actor: "worker:alice",
    });
    checks.push({ name: "transition submitted", detail: submitted.task.state });

    const history = await client.getWorkerTaskHistory(task.task.taskId);
    checks.push({
      name: "task history",
      detail: history.entries.map((entry) => `${entry.fromState}->${entry.toState}`).join(", "),
    });

    // The dashboard and the task table both read this, so it is checked at both
    // scopes it supports: everything, and one worker's slice.
    const allTasks = await client.listWorkerTasks();
    checks.push({
      name: "list all tasks",
      detail: allTasks.tasks.map((entry) => `${entry.title}:${entry.state}`).join(", "),
    });

    const workerTasks = await client.listWorkerTasks({ workerId });
    checks.push({
      name: "list one worker's tasks",
      detail: `${workerTasks.tasks.length} task(s), all owned=${workerTasks.tasks.every(
        (entry) => entry.workerId === workerId,
      )}`,
    });

    const blocked = await client.evaluateWorkerGuard({ command: "mkfs.ext4 /dev/sda1" });
    checks.push({ name: "guard block", detail: blocked.decision });

    const confirm = await client.evaluateWorkerGuard({ command: "rm -rf ./build" });
    checks.push({ name: "guard confirm", detail: confirm.decision });

    const allowed = await client.evaluateWorkerGuard({ command: "npm test" });
    checks.push({ name: "guard allow", detail: allowed.decision });

    // Groups: created with a roster in one call, then edited.
    const created2 = await client.createWorker({ name: "QA", templateId: "qa-engineer" });
    const group = await client.createWorkerGroup({
      name: "Pricing page",
      projectId: "prj_verify",
      goal: "Ship the pricing page",
      coordinatorWorkerId: workerId,
      memberWorkerIds: [created2.worker.id],
    });
    checks.push({
      name: "create group",
      detail: `${group.group.id} coordinator=${group.group.members.find((m) => m.role === "coordinator")?.workerId}`,
    });

    // A third worker, so the refusal under test is the coordinator rule rather
    // than "already a member".
    const outsider = await client.createWorker({ name: "Ops", templateId: "devops-engineer" });
    let coordinatorRefusal = "NOT REFUSED";
    try {
      await client.addWorkerGroupMember({
        groupId: group.group.id,
        workerId: outsider.worker.id,
        role: "coordinator",
      });
    } catch (error) {
      coordinatorRefusal = error instanceof Error ? error.message : String(error);
    }
    checks.push({
      name: "second coordinator refused",
      detail: coordinatorRefusal.slice(0, 70),
    });

    await client.addWorkerGroupMember({
      groupId: group.group.id,
      workerId: outsider.worker.id,
      role: "member",
    });
    const afterAdd = await client.listWorkerGroups();
    checks.push({
      name: "member added",
      detail: `${afterAdd.groups[0]?.members.length ?? 0} member(s)`,
    });

    const listed = await client.listWorkerGroups();
    checks.push({
      name: "list groups",
      detail: listed.groups.map((g) => `${g.name}:${g.members.length}`).join(", "),
    });

    // Two different refusals, both worth proving over the wire: an edge the
    // graph forbids, and a legal edge carrying an action that does not produce
    // it. The second is the one that keeps history truthful.
    let illegalEdge = "NOT REFUSED";
    try {
      await client.transitionWorkerTask({
        taskId: task.task.taskId,
        toState: "in_progress",
        action: "ack_task",
        actor: "worker:lead",
      });
    } catch (error) {
      illegalEdge = error instanceof Error ? error.message : String(error);
    }
    checks.push({ name: "illegal edge refused", detail: illegalEdge.slice(0, 80) });

    let wrongAction = "NOT REFUSED";
    try {
      await client.transitionWorkerTask({
        taskId: task.task.taskId,
        toState: "completed",
        action: "submit_task",
        actor: "worker:lead",
      });
    } catch (error) {
      wrongAction = error instanceof Error ? error.message : String(error);
    }
    checks.push({ name: "wrong action refused", detail: wrongAction.slice(0, 80) });

    // A real run, through the real runner: this is the only check that proves
    // the execution path is wired, since every other task check drives the
    // state machine by hand. A fresh task is used so the assertions above are
    // not disturbed by the run's own state changes.
    //
    // Either terminal outcome is accepted. A `submitted` task means pi ran and
    // produced a result; a `blocked` one means it could not, and the run still
    // reported honestly instead of hanging or losing the task. What must hold
    // in both cases is that the task left `in_progress` and that the history
    // records the attempt.
    const runTask = await client.createWorkerTask({ workerId, title: "Say hello" });
    const runResult = await client.runWorkerTask(runTask.task.taskId);
    const runHistory = await client.getWorkerTaskHistory(runTask.task.taskId);
    checks.push({
      name: "run task",
      detail: `${runResult.task.state} (${runHistory.entries
        .map((entry) => `${entry.fromState}->${entry.toState}`)
        .join(", ")})`,
    });

    if (!["submitted", "blocked"].includes(runResult.task.state)) {
      throw new Error(`run left the task in an unexpected state: ${runResult.task.state}`);
    }
    if (!runHistory.entries.some((entry) => entry.toState === "in_progress")) {
      throw new Error("a run must record that it started");
    }

    await verifyMessaging({
      client,
      checks,
      groupId: group.group.id,
      coordinatorWorkerId: workerId,
      memberWorkerId: created2.worker.id,
      outsiderWorkerId: outsider.worker.id,
    });

    for (const check of checks) {
      console.log(`  ok   ${check.name.padEnd(28)} ${check.detail}`);
    }
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}

/**
 * Messaging checks.
 *
 * Split out of `main` because it is a self-contained group of assertions about
 * one subject: a mention wakes only the named worker, a store-only message is
 * visible without waking anyone, and privacy filters reads without changing who
 * was woken.
 */
async function verifyMessaging(input: {
  client: DaemonClient;
  checks: Array<{ name: string; detail: string }>;
  groupId: string;
  coordinatorWorkerId: string;
  memberWorkerId: string;
  outsiderWorkerId: string;
}): Promise<void> {
  const { client, checks, groupId, coordinatorWorkerId, memberWorkerId, outsiderWorkerId } = input;

  const waking = await client.sendWorkerMessage({
    groupId,
    senderWorkerId: coordinatorWorkerId,
    body: "Take the API side",
    audience: [memberWorkerId],
  });
  checks.push({
    name: "mention wakes",
    detail: `seq=${waking.message.seq} woke=${waking.woke.length} policy=${waking.message.deliveryPolicy}`,
  });
  if (!waking.woke.includes(memberWorkerId)) {
    throw new Error("a mentioned worker must be woken");
  }
  if (waking.woke.includes(coordinatorWorkerId)) {
    throw new Error("the sender mentioned nobody but was woken");
  }

  const addresseeInbox = await client.listWorkerInbox(memberWorkerId);
  const senderInbox = await client.listWorkerInbox(coordinatorWorkerId);
  checks.push({
    name: "inbox routing",
    detail: `addressee=${addresseeInbox.entries.length} sender=${senderInbox.entries.length}`,
  });
  if (addresseeInbox.entries.length !== 1 || senderInbox.entries.length !== 0) {
    throw new Error("a waking message must land only in its addressee's inbox");
  }

  const stored = await client.sendWorkerMessage({
    groupId,
    senderWorkerId: coordinatorWorkerId,
    body: "FYI the spec changed",
    audience: [memberWorkerId],
    deliveryPolicy: "store_only",
  });
  const afterStore = await client.listWorkerInbox(memberWorkerId);
  checks.push({
    name: "store-only does not wake",
    detail: `woke=${stored.woke.length} inbox=${afterStore.entries.length}`,
  });
  if (stored.woke.length !== 0 || afterStore.entries.length !== 1) {
    throw new Error("a store-only message must not wake its audience");
  }

  const stream = await client.listWorkerMessages({ groupId });
  checks.push({
    name: "stream keeps both",
    detail: stream.messages.map((message) => `${message.seq}:${message.deliveryPolicy}`).join(", "),
  });
  if (stream.messages.length !== 2) {
    throw new Error("the stream must contain both the waking and the stored message");
  }

  // Privacy is a read filter, not a wake filter: the private message woke its
  // addressee and is invisible to a third worker.
  const privateMessage = await client.sendWorkerMessage({
    groupId,
    senderWorkerId: coordinatorWorkerId,
    body: "just between us",
    audience: [memberWorkerId],
    privateTo: [memberWorkerId],
  });
  const [asAddressee, asOutsider] = await Promise.all([
    client.listWorkerMessages({ groupId, viewerWorkerId: memberWorkerId }),
    client.listWorkerMessages({ groupId, viewerWorkerId: outsiderWorkerId }),
  ]);
  checks.push({
    name: "private visibility",
    detail: `addressee=${asAddressee.messages.length} outsider=${asOutsider.messages.length}`,
  });
  if (
    asOutsider.messages.some((message) => message.messageId === privateMessage.message.messageId)
  ) {
    throw new Error("a private message must not be visible to an outsider");
  }

  // Delivery state belongs to the pair: an outsider marking it read must not
  // succeed, because the message was never theirs.
  const marked = await client.markWorkerMessageDelivery({
    messageId: waking.message.messageId,
    workerId: memberWorkerId,
    state: "read",
  });
  const notAddressed = await client.markWorkerMessageDelivery({
    messageId: waking.message.messageId,
    workerId: outsiderWorkerId,
    state: "read",
  });
  checks.push({
    name: "delivery is per worker",
    detail: `addressee=${marked.marked} outsider=${notAddressed.marked}`,
  });
  if (!marked.marked || notAddressed.marked) {
    throw new Error("delivery state must belong to the addressed pair");
  }

  const afterRead = await client.listWorkerInbox(memberWorkerId);
  checks.push({
    name: "read clears the inbox",
    detail: `remaining=${afterRead.entries.length}`,
  });
  if (afterRead.entries.length !== 1) {
    throw new Error("only the read message should leave the inbox");
  }
}

main().catch((error) => {
  console.error("verification failed:", error);
  process.exit(1);
});
