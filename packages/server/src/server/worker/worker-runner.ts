/**
 * Running a worker task.
 *
 * A worker task is an agent session with a role. That is the whole translation:
 * the daemon already knows how to create an agent, give it a prompt, and wait
 * for it to settle, so this module only decides what the session looks like and
 * how its outcome maps onto the task's state machine.
 *
 * Deliberately not a new execution mechanism. It uses the same create-agent
 * command and run/wait pair the scheduler uses, which means it inherits the
 * daemon's workspace handling, permission requests, cancellation, and
 * notification behaviour instead of reimplementing them.
 */
import type { Logger } from "pino";

import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import type {
  BoundCreateAgentCommand,
  CreateAgentCommandResult,
} from "../agent/create-agent/create.js";
import type { WorkerTaskRecord } from "./worker-store.js";
import { buildWorkerSessionConfig } from "./worker-session-config.js";
import type { WorkerTemplate } from "./worker-template.js";

/** The subset of AgentManager a worker run needs. Narrow so tests need no fake manager. */
export interface WorkerRunAgentManager {
  runAgent(agentId: string, prompt: AgentPromptInput): Promise<{ canceled?: boolean }>;
  waitForAgentEvent(
    agentId: string,
    options: { waitForActive: boolean },
  ): Promise<{ permission?: unknown }>;
}

export interface WorkerRunnerOptions {
  logger: Logger;
  createAgent: BoundCreateAgentCommand;
  agentManager: WorkerRunAgentManager;
  /**
   * Resolves a worker's workspace to a BySpace workspace id, adopting it as a
   * workspace on first use. The worker's name is passed through because
   * adopting a directory needs something to name it by, and the worker is what
   * the directory belongs to.
   */
  resolveWorkspaceId: (input: {
    workspacePath: string;
    workerName: string;
  }) => Promise<string | null>;
}

/**
 * Launch a role session and give it one unit of work.
 *
 * A task run and a message wake are the same operation with a different prompt:
 * the only difference is whether the session belongs to a task or to a run, and
 * that is carried in the labels the caller supplies. Sharing this is what keeps
 * the two from drifting apart.
 */
interface LaunchInput {
  workerId: string;
  workerName: string;
  workspacePath: string;
  template: WorkerTemplate;
  /** Framing appended after the role prompt, describing this unit of work. */
  prompt: string;
  title: string;
  labels: Record<string, string>;
}

type LaunchResult =
  | { ok: true; agentId: string }
  | { ok: false; agentId: string | null; reason: string };

export interface WakeWorkerInput {
  workerId: string;
  workerName: string;
  workspacePath: string;
  template: WorkerTemplate;
  groupId: string;
  runId: string;
  /** The wake framing: what arrived, and what the worker is expected to do. */
  wakePrompt: string;
  /**
   * Called with the session id after the session exists and before it is given
   * its turn.
   *
   * The caller uses this to attach the session to its run, and it has to happen
   * in this window: a worker that tries to reply resolves its own identity from
   * that attachment, so attaching after the turn starts would make the first
   * reply fail to identify its sender.
   */
  onSessionCreated: (sessionId: string) => void;
}

/**
 * How a wake ended.
 *
 * Distinct from a task outcome because the recovery differs: a task that blocks
 * stays blocked for a person to notice, while a wake that does not finish must
 * hand its messages back so the work is picked up again.
 */
export type WorkerWakeOutcome =
  | { kind: "succeeded"; sessionId: string }
  | { kind: "blocked"; sessionId: string; reason: string }
  | { kind: "cancelled"; sessionId: string }
  | { kind: "failed"; sessionId: string | null; reason: string };

export interface RunWorkerTaskInput {
  workerId: string;
  workerName: string;
  workspacePath: string;
  template: WorkerTemplate;
  task: WorkerTaskRecord;
}

export type WorkerRunOutcome =
  | { kind: "submitted"; agentId: string }
  | { kind: "blocked"; agentId: string; reason: string }
  | { kind: "failed"; agentId: string | null; reason: string };

export class WorkerWorkspaceUnresolvedError extends Error {
  constructor(workspacePath: string) {
    super(
      `Worker workspace ${workspacePath} is not a known BySpace workspace, so a task cannot run there.`,
    );
    this.name = "WorkerWorkspaceUnresolvedError";
  }
}

export class WorkerRunner {
  constructor(private readonly options: WorkerRunnerOptions) {}

  /**
   * Run one task to a terminal outcome.
   *
   * The result is translated rather than thrown: a task that could not run is a
   * `blocked` task, not an exception the caller has to interpret. Only a
   * programming error (an unknown workspace) throws, because that is a
   * configuration fault rather than a task outcome.
   */
  async run(input: RunWorkerTaskInput): Promise<WorkerRunOutcome> {
    const launched = await this.launch({
      workerId: input.workerId,
      workerName: input.workerName,
      workspacePath: input.workspacePath,
      template: input.template,
      prompt: input.task.title,
      title: input.task.title,
      labels: {
        // The label is how a session is traced back to the worker that owns
        // it; without it a run is an anonymous agent in the workspace list.
        "byspace.worker-id": input.workerId,
        "byspace.worker-task": input.task.taskId,
      },
    });
    if (!launched.ok) {
      return { kind: "failed", agentId: launched.agentId, reason: launched.reason };
    }
    const agentId = launched.agentId;

    const run = await this.options.agentManager.runAgent(agentId, input.task.title);
    const settled = await this.options.agentManager.waitForAgentEvent(agentId, {
      waitForActive: true,
    });

    if (run.canceled) {
      return { kind: "blocked", agentId, reason: "canceled" };
    }

    // A worker that stops for a permission decision is waiting on a person, not
    // finished. Reporting `submitted` would put an unfinished result in the
    // review queue.
    if (settled.permission) {
      return {
        kind: "blocked",
        agentId,
        reason: "the worker is waiting for a permission decision",
      };
    }

    return { kind: "submitted", agentId };
  }

  /**
   * Carry out one wake: give a woken worker its turn and report how it ended.
   *
   * The session id is reported even on failure where one exists, because the run
   * has to be settled against the session that was created.
   */
  async wake(input: WakeWorkerInput): Promise<WorkerWakeOutcome> {
    const launched = await this.launch({
      workerId: input.workerId,
      workerName: input.workerName,
      workspacePath: input.workspacePath,
      template: input.template,
      prompt: input.wakePrompt,
      title: input.wakePrompt.slice(0, 80),
      labels: {
        "byspace.worker-id": input.workerId,
        "byspace.worker-group": input.groupId,
        "byspace.worker-run": input.runId,
      },
    });
    if (!launched.ok) {
      return { kind: "failed", sessionId: launched.agentId, reason: launched.reason };
    }
    const sessionId = launched.agentId;
    input.onSessionCreated(sessionId);

    const run = await this.options.agentManager.runAgent(sessionId, input.wakePrompt);
    if (run.canceled) {
      return { kind: "cancelled", sessionId };
    }
    const settled = await this.options.agentManager.waitForAgentEvent(sessionId, {
      waitForActive: true,
    });

    if (settled.permission) {
      // A worker stopped mid-turn by a permission decision has not finished, so
      // the wake has not either: its messages go back rather than read.
      return {
        kind: "blocked",
        sessionId,
        reason: "the worker is waiting for a permission decision",
      };
    }
    return { kind: "succeeded", sessionId };
  }

  /** Create the session a task run or a wake executes in. */
  private async launch(input: LaunchInput): Promise<LaunchResult> {
    const workspaceId = await this.options.resolveWorkspaceId({
      workspacePath: input.workspacePath,
      workerName: input.workerName,
    });
    if (!workspaceId) {
      throw new WorkerWorkspaceUnresolvedError(input.workspacePath);
    }

    const { config } = buildWorkerSessionConfig({
      template: input.template,
      cwd: input.workspacePath,
      taskPrompt: input.prompt,
      title: input.title,
    });

    let created: CreateAgentCommandResult;
    try {
      created = await this.options.createAgent({
        kind: "mcp",
        provider: config.provider,
        config,
        cwd: input.workspacePath,
        workspaceId,
        title: input.title,
        labels: input.labels,
        unattended: true,
        promptFailure: "return-error",
        background: true,
        notifyOnFinish: false,
      });
    } catch (error) {
      return {
        ok: false,
        agentId: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const agentId = created.snapshot.id;

    if (created.initialPromptError) {
      return {
        ok: false,
        agentId,
        reason:
          created.initialPromptError instanceof Error
            ? created.initialPromptError.message
            : String(created.initialPromptError),
      };
    }

    return { ok: true, agentId };
  }
}
