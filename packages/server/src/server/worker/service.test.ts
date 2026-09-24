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

import { WorkerRunUnavailableError, WorkerService } from "./service.js";
import type { WorkerRunner } from "./worker-runner.js";

const silentLogger = pino({ level: "silent" });

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
