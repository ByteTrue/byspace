/**
 * The run executor: taking a queued task to a finished run whose output is a
 * comment on its issue.
 *
 * The source's shape: the daemon claims a queued task, prepares a session,
 * runs the agent against the issue's context, writes the run's output back
 * as a comment (source_task_id linking comment to run), and settles the task
 * through its lifecycle. The executor here keeps that order with one change
 * the storage decision explains: there is no separate claiming daemon — the
 * executor runs in-process against BySpace's agent-manager seam (createAgent
 * + runAgent + waitForAgentEvent), the same seam the schedule service drives.
 *
 * Failure semantics from the source: a failed run settles the task failed
 * with its reason and does NOT retry beyond max_attempts (055's columns);
 * the run's error is visible on the issue as the failure comment, because a
 * person looking at the issue is the one who needs to know.
 */
import type pino from "pino";

import type { AgentManager } from "../agent/agent-manager.js";
import { type BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import type { MulticaStore } from "./store.js";
import type { TaskRow } from "./rows.js";
import {
  createAutopilotRunOnlyPrompt,
  createCommentPrompt,
  createIssuePrompt,
  createWakeupPrompt,
} from "./run-prompt.js";

export interface MulticaExecutorOptions {
  store: MulticaStore;
  agentManager: AgentManager;
  createAgent: BoundCreateAgentCommand;
  /** Resolves the working directory for an issue's runs. */
  resolveWorkspace: (issueId: string) => Promise<{ cwd: string; workspaceId: string } | null>;
  /** Resolves the working directory for an autopilot's run_only runs. */
  resolveAutopilotWorkspace: (
    autopilotId: string,
  ) => Promise<{ cwd: string; workspaceId: string } | null>;
  /** Notified when the executor itself enqueues new work (a retry child). */
  onEnqueued?: () => void;
  logger: pino.Logger;
}

export class MulticaExecutor {
  readonly #store: MulticaStore;
  readonly #agentManager: AgentManager;
  readonly #createAgent: BoundCreateAgentCommand;
  readonly #resolveWorkspace: MulticaExecutorOptions["resolveWorkspace"];
  readonly #resolveAutopilotWorkspace: MulticaExecutorOptions["resolveAutopilotWorkspace"];
  readonly #onEnqueued: (() => void) | undefined;
  readonly #logger: pino.Logger;
  readonly #inFlight = new Set<string>();

  constructor(options: MulticaExecutorOptions) {
    this.#store = options.store;
    this.#agentManager = options.agentManager;
    this.#createAgent = options.createAgent;
    this.#resolveWorkspace = options.resolveWorkspace;
    this.#resolveAutopilotWorkspace = options.resolveAutopilotWorkspace;
    this.#onEnqueued = options.onEnqueued;
    this.#logger = options.logger;
  }

  /**
   * Drain every queued task, one at a time per agent.
   *
   * The concurrency contract: one run per agent at a time (the source's
   * agent.max_concurrent_tasks, which is 1 in this form factor). The in-flight
   * set enforces it in-process; the queue row's status is the durable guard.
   */
  /**
   * Claim and execute every queued run. The in-process in-flight set plus
   * the queue row's status guard make a double-claim impossible here. That
   * equivalence rests on one recorded premise: this replica deploys one
   * daemon per host (the source's SKIP LOCKED exists for multi-daemon
   * fleets). If a second daemon ever joins, claiming must move to a
   * database-level atomic claim — not a second in-process set.
   */
  async drain(): Promise<number> {
    let executed = 0;
    for (const task of this.#store.listQueuedTasks()) {
      if (this.#inFlight.has(task.agentId)) {
        continue;
      }
      this.#inFlight.add(task.agentId);
      try {
        await this.#execute(task.id);
        executed += 1;
      } finally {
        this.#inFlight.delete(task.agentId);
      }
    }
    return executed;
  }

  async #execute(taskId: string): Promise<void> {
    const task = this.#store.getTask(taskId);
    if (task.status !== "queued") {
      return;
    }
    this.#store.updateTaskStatus({ id: task.id, status: "dispatched" });
    let startupFailed = false;
    try {
      if (task.issueId === null && task.autopilotRunId !== null) {
        await this.#executeAutopilotRunOnly(task);
        return;
      }
      const issue = this.#store.getIssue(task.issueId as string);
      const agent = this.#store.getAgent(task.agentId);
      const workspace = await this.#resolveWorkspace(task.issueId as string);
      if (!workspace) {
        throw new Error(`no workspace resolved for issue ${task.issueId}`);
      }

      const wakeup = readWakeupContext(task.context);
      let prompt: string;
      if (wakeup) {
        prompt = createWakeupPrompt({
          issue,
          agent,
          wakeupId: wakeup.wakeupId,
          instruction: this.#store.getWakeup(wakeup.wakeupId).instruction,
          evidence: wakeup.evidence,
        });
      } else if (task.triggerCommentId !== null) {
        prompt = createCommentPrompt({
          issue,
          agent,
          comment: this.#store.getComment(task.triggerCommentId),
        });
      } else {
        prompt = createIssuePrompt({ issue, agent });
      }

      this.#store.updateTaskStatus({ id: task.id, status: "running" });
      let created;
      try {
        created = await this.#createAgent({
          kind: "mcp",
          provider: "pi",
          config: {},
          cwd: workspace.cwd,
          workspaceId: workspace.workspaceId,
          title: `${issue.title} — ${agent.name}`,
          labels: { "multica.task-id": task.id, "multica.issue-id": issue.id },
          unattended: true,
          promptFailure: "return-error",
          background: true,
          notifyOnFinish: false,
        });
        if (created.initialPromptError) {
          throw created.initialPromptError;
        }
      } catch (error) {
        // The environment never came up: the source retries exactly this
        // class (runtime recovery / offline), and never a mid-run error.
        startupFailed = true;
        throw error;
      }
      // The run's identity: from here the daemon can reverse-resolve any
      // session to its run, which is how an agent's comments attribute to
      // the agent rather than to the owner.
      this.#store.attachTaskSession(task.id, created.snapshot.id);
      const result = await this.#agentManager.runAgent(created.snapshot.id, prompt);
      const waitResult = await this.#agentManager.waitForAgentEvent(created.snapshot.id, {
        waitForActive: true,
      });
      if (result.canceled) {
        this.#store.updateTaskStatus({ id: task.id, status: "cancelled", error: "canceled" });
        return;
      }
      if (waitResult.permission) {
        this.#store.updateTaskStatus({
          id: task.id,
          status: "failed",
          error: "waiting for permission",
        });
        this.#noteFailureForOwner(task, "waiting for permission");
        return;
      }
      const output = waitResult.lastMessage ?? result.finalText ?? "";
      // The run's report is a comment on the issue, attributed to the agent
      // and linked to the task — the record the issue is.
      this.#store.createComment({
        issueId: issue.id,
        authorType: "agent",
        authorId: task.agentId,
        content: output,
        sourceTaskId: task.id,
      });
      this.#store.updateTaskStatus({
        id: task.id,
        status: "completed",
        result: output,
      });
      if (task.issueId !== null) {
        this.#store.recordActivity({
          issueId: task.issueId,
          actorType: "agent",
          actorId: task.agentId,
          action: "task_completed",
        });
      }
      this.#settleLinkedRun(task, "completed", null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The issue can be deleted while a run is in flight: the source
      // cancels the run inside the same transaction as the delete, so its
      // task rows vanish with the issue. Our delete cancels first, but a
      // run already past claim holds no such promise — settling against a
      // vanished row would throw and leave the drain loop holding a dead
      // agent slot. Drop the settlement instead; the record went with the
      // issue, by the owner's own hand.
      if (!this.#store.taskExists(task.id)) {
        this.#logger.warn(
          { taskId: task.id, issueId: task.issueId },
          "multica run's task row vanished mid-run (issue deleted); dropping settlement",
        );
        return;
      }
      this.#logger.warn({ err: error, taskId: task.id }, "multica run failed");
      this.#store.updateTaskStatus({ id: task.id, status: "failed", error: message });
      if (startupFailed) {
        this.#spawnRetryChild(task);
      }
      if (task.issueId !== null) {
        this.#store.recordActivity({
          issueId: task.issueId,
          actorType: "agent",
          actorId: task.agentId,
          action: "task_failed",
          details: { error: message.slice(0, 500) },
        });
      }
      this.#settleLinkedRun(task, "failed", message);
      this.#noteFailureForOwner(task, message);
    }
  }

  /**
   * A run_only autopilot task: no issue exists, the brief is the autopilot's
   * instructions, and the run row — not a comment — is the record.
   */
  async #executeAutopilotRunOnly(task: TaskRow): Promise<void> {
    const run = this.#store.getAutopilotRun(task.autopilotRunId as string);
    const autopilot = this.#store.getAutopilot(run.autopilotId);
    const agent = this.#store.getAgent(task.agentId);
    const workspace = await this.#resolveAutopilotWorkspace(autopilot.id);
    if (!workspace) {
      throw new Error(`no workspace resolved for autopilot ${autopilot.id}`);
    }
    const prompt = createAutopilotRunOnlyPrompt({
      agent,
      autopilotId: autopilot.id,
      autopilotTitle: autopilot.title,
      autopilotDescription: autopilot.description,
      runId: run.id,
      source: run.source,
    });
    const created = await this.#createAgent({
      kind: "mcp",
      provider: "pi",
      config: {},
      cwd: workspace.cwd,
      workspaceId: workspace.workspaceId,
      title: `${autopilot.title} — ${agent.name}`,
      labels: { "multica.task-id": task.id, "multica.autopilot-run-id": run.id },
      unattended: true,
      promptFailure: "return-error",
      background: true,
      notifyOnFinish: false,
    });
    if (created.initialPromptError) {
      throw created.initialPromptError;
    }
    this.#store.attachTaskSession(task.id, created.snapshot.id);
    const result = await this.#agentManager.runAgent(created.snapshot.id, prompt);
    const waitResult = await this.#agentManager.waitForAgentEvent(created.snapshot.id, {
      waitForActive: true,
    });
    if (result.canceled) {
      this.#store.updateTaskStatus({ id: task.id, status: "cancelled", error: "canceled" });
      this.#store.updateAutopilotRun({ id: run.id, status: "failed", failureReason: "canceled" });
      return;
    }
    if (waitResult.permission) {
      this.#store.updateTaskStatus({
        id: task.id,
        status: "failed",
        error: "waiting for permission",
      });
      this.#store.updateAutopilotRun({
        id: run.id,
        status: "failed",
        failureReason: "waiting for permission",
      });
      this.#noteFailureForOwner(task, "waiting for permission");
      return;
    }
    const output = waitResult.lastMessage ?? result.finalText ?? "";
    this.#store.updateTaskStatus({ id: task.id, status: "completed", result: output });
    this.#store.updateAutopilotRun({ id: run.id, status: "completed", result: output });
  }

  /**
   * The retry lineage: a startup-phase failure enqueues a child — attempt
   * plus one, pointing at its parent — up to the attempt ceiling. Past the
   * ceiling the failure stands as the final word and reaches the owner's
   * inbox like any other failure. Cancelled runs and permission gates never
   * arrive here (they return, they do not throw), and mid-run errors carry
   * no structured reason code, so retrying them would gamble an expensive
   * loop on luck — the source retries only its enumerated transient reasons.
   */
  #spawnRetryChild(task: TaskRow): void {
    if (task.attempt >= task.maxAttempts) {
      return;
    }
    const child = this.#store.createRetryTask(task);
    this.#logger.info(
      { parentTaskId: task.id, childTaskId: child.id, attempt: child.attempt },
      "multica run retry enqueued",
    );
    this.#onEnqueued?.();
  }

  /**
   * A task linked to an autopilot run settles it with the task's outcome:
   * the run row is the autopilot's audit trail (the source's
   * SyncRunFromTask).
   */
  #settleLinkedRun(
    task: TaskRow,
    status: "completed" | "failed",
    failureReason: string | null,
  ): void {
    if (task.autopilotRunId === null) {
      return;
    }
    this.#store.updateAutopilotRun({
      id: task.autopilotRunId,
      status,
      ...(failureReason !== null ? { failureReason } : {}),
      ...(status === "completed" ? { result: task.result } : {}),
    });
  }

  /**
   * A failed run is the owner's problem, not the issue's alone: the source
   * writes an action_required inbox item on run failure. The inbox is where
   * "needs your decision" lives.
   */
  #noteFailureForOwner(task: TaskRow, message: string): void {
    // A run_only task has no issue: the inbox item then points at the
    // autopilot run instead.
    this.#store.createInboxItem({
      type: "run.failed",
      severity: "action_required",
      issueId: task.issueId,
      title:
        task.issueId !== null
          ? `Run failed on issue ${task.issueId.slice(0, 8)}`
          : `Run failed (autopilot run ${task.autopilotRunId?.slice(0, 8) ?? "?"})`,
      body: message.slice(0, 2000),
      actorType: "agent",
      actorId: task.agentId,
      details: { task_id: task.id },
    });
  }
}

/** The wakeup identity a dispatched run carries in its context column. */
function readWakeupContext(
  contextJson: string | null | undefined,
): { wakeupId: string; evidence: Record<string, unknown>[] } | null {
  if (!contextJson) {
    return null;
  }
  let context: Record<string, unknown>;
  try {
    context = JSON.parse(contextJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const wakeupId = context.wakeup_id;
  if (typeof wakeupId !== "string" || wakeupId === "") {
    return null;
  }
  const evidence = Array.isArray(context.wakeup_evidence)
    ? (context.wakeup_evidence as Record<string, unknown>[])
    : [];
  return { wakeupId, evidence };
}
