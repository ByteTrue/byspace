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

    for (const check of checks) {
      console.log(`  ok   ${check.name.padEnd(28)} ${check.detail}`);
    }
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}

main().catch((error) => {
  console.error("verification failed:", error);
  process.exit(1);
});
