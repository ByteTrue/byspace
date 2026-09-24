/**
 * Tests for running a worker task.
 *
 * The runner's job is the mapping: session outcome -> task outcome, and role
 * prompt -> session family. Both are decisions, so both are pinned here. The
 * agent creation, run, and wait calls are the daemon's, and are faked rather
 * than reimplemented.
 */
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { CreateAgentCommandResult } from "../agent/create-agent/create.js";
import type { WorkerTaskRecord } from "./worker-store.js";
import type { WorkerTemplate } from "./worker-template.js";
import {
  WorkerRunner,
  WorkerWorkspaceUnresolvedError,
  type WorkerRunAgentManager,
} from "./worker-runner.js";

const TEMPLATE: WorkerTemplate = {
  id: "frontend-developer",
  title: "Frontend Developer",
  parts: {
    IDENTITY: "# Identity — Frontend Developer\n\nYou build interfaces.",
    PERSONA: "# Persona\n\nDirect.",
    BIBLE: "# Bible\n\nDesign before code.",
  },
  skills: [],
};

const TASK: WorkerTaskRecord = {
  taskId: "wtk_1",
  workerId: "wkr_1",
  title: "Build the pricing table",
  state: "assigned",
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

interface Harness {
  runner: WorkerRunner;
  createAgent: ReturnType<typeof vi.fn>;
  runAgent: ReturnType<typeof vi.fn>;
  waitForAgentEvent: ReturnType<typeof vi.fn>;
}

function createHarness(
  overrides: {
    createAgentResult?: Partial<CreateAgentCommandResult>;
    createAgentThrows?: Error;
    runCanceled?: boolean;
    permission?: unknown;
    workspaceId?: string | null;
  } = {},
): Harness {
  const createAgent = vi.fn(async () => {
    if (overrides.createAgentThrows) throw overrides.createAgentThrows;
    return {
      snapshot: { id: "agent_1" },
      liveSnapshot: { id: "agent_1" },
      background: true,
      initialPromptStarted: false,
      initialPromptError: null,
      ...overrides.createAgentResult,
    } as unknown as CreateAgentCommandResult;
  });

  const runAgent = vi.fn(async () => ({ canceled: overrides.runCanceled ?? false }));
  const waitForAgentEvent = vi.fn(async () => ({ permission: overrides.permission }));

  const agentManager: WorkerRunAgentManager = { runAgent, waitForAgentEvent };

  const runner = new WorkerRunner({
    logger: pino({ level: "silent" }),
    createAgent: createAgent as never,
    agentManager,
    resolveWorkspaceId: async () =>
      overrides.workspaceId === undefined ? "ws_1" : overrides.workspaceId,
  });

  return { runner, createAgent, runAgent, waitForAgentEvent };
}

const INPUT = {
  workerId: "wkr_1",
  workerName: "Alice",
  workspacePath: "/repo",
  template: TEMPLATE,
  task: TASK,
};

describe("worker runner", () => {
  it("runs the task and reports it submitted", async () => {
    const harness = createHarness();
    const outcome = await harness.runner.run(INPUT);

    expect(outcome).toEqual({ kind: "submitted", agentId: "agent_1" });
    expect(harness.runAgent).toHaveBeenCalledWith("agent_1", TASK.title);
  });

  it("carries the worker's role into the session it creates", async () => {
    // Without the role prompt the run would be a generic agent doing a task,
    // which is the whole thing a worker is supposed to change.
    const harness = createHarness();
    await harness.runner.run(INPUT);

    const input = harness.createAgent.mock.calls[0]?.[0] as {
      config: { provider: string; cwd: string; systemPrompt?: string };
      workspaceId: string;
      cwd: string;
    };
    expect(input.config.provider).toBe("pi");
    expect(input.config.cwd).toBe("/repo");
    expect(input.config.systemPrompt).toContain("You build interfaces.");
    expect(input.config.systemPrompt).toContain("Design before code.");
    expect(input.config.systemPrompt).toContain(TASK.title);
    expect(input.workspaceId).toBe("ws_1");
  });

  it("labels the session so a run can be traced back to its worker", async () => {
    const harness = createHarness();
    await harness.runner.run(INPUT);

    const input = harness.createAgent.mock.calls[0]?.[0] as { labels: Record<string, string> };
    expect(input.labels["byspace.worker-id"]).toBe("wkr_1");
    expect(input.labels["byspace.worker-task"]).toBe("wtk_1");
  });

  it("runs unattended, without notifying on finish", async () => {
    // The task's state is the notification; a per-run notice would duplicate it.
    const harness = createHarness();
    await harness.runner.run(INPUT);

    const input = harness.createAgent.mock.calls[0]?.[0] as {
      unattended: boolean;
      notifyOnFinish: boolean;
    };
    expect(input.unattended).toBe(true);
    expect(input.notifyOnFinish).toBe(false);
  });

  it("reports a permission stop as blocked, not submitted", async () => {
    // A worker waiting on a decision has not produced a result; filing it as
    // submitted would put half-finished work in the review queue.
    const harness = createHarness({ permission: { id: "perm_1" } });
    const outcome = await harness.runner.run(INPUT);

    expect(outcome).toMatchObject({ kind: "blocked", agentId: "agent_1" });
    if (outcome.kind !== "blocked") return;
    expect(outcome.reason).toContain("permission");
  });

  it("reports a canceled run as blocked", async () => {
    const harness = createHarness({ runCanceled: true });
    const outcome = await harness.runner.run(INPUT);
    expect(outcome).toMatchObject({ kind: "blocked", reason: "canceled" });
  });

  it("reports a failed session creation as failed, with no agent", async () => {
    const harness = createHarness({ createAgentThrows: new Error("provider unavailable") });
    const outcome = await harness.runner.run(INPUT);

    expect(outcome).toEqual({ kind: "failed", agentId: null, reason: "provider unavailable" });
    // Nothing was run, and the runner must not pretend otherwise.
    expect(harness.runAgent).not.toHaveBeenCalled();
  });

  it("reports a failed initial prompt against the agent that exists", async () => {
    // The agent was created, so the failure belongs to it; losing the id would
    // leave an orphan session nobody can find.
    const harness = createHarness({
      createAgentResult: { initialPromptError: new Error("prompt rejected") },
    });
    const outcome = await harness.runner.run(INPUT);

    expect(outcome).toEqual({ kind: "failed", agentId: "agent_1", reason: "prompt rejected" });
    expect(harness.runAgent).not.toHaveBeenCalled();
  });

  it("refuses to run when the workspace is not known to BySpace", async () => {
    // A configuration fault rather than a task outcome: there is nowhere to run,
    // so this throws instead of being filed as a blocked task.
    const harness = createHarness({ workspaceId: null });
    await expect(harness.runner.run(INPUT)).rejects.toThrow(WorkerWorkspaceUnresolvedError);
    expect(harness.createAgent).not.toHaveBeenCalled();
  });
});
