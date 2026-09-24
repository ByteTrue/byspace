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
      taskPrompt: input.task.title,
      title: input.task.title,
    });

    let created: CreateAgentCommandResult;
    try {
      created = await this.options.createAgent({
        kind: "mcp",
        provider: config.provider,
        config,
        cwd: input.workspacePath,
        workspaceId,
        title: input.task.title,
        labels: {
          // The label is how a session is traced back to the worker that owns
          // it; without it a run is an anonymous agent in the workspace list.
          "byspace.worker-id": input.workerId,
          "byspace.worker-task": input.task.taskId,
        },
        unattended: true,
        promptFailure: "return-error",
        background: true,
        notifyOnFinish: false,
      });
    } catch (error) {
      return {
        kind: "failed",
        agentId: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const agentId = created.snapshot.id;

    if (created.initialPromptError) {
      return {
        kind: "failed",
        agentId,
        reason:
          created.initialPromptError instanceof Error
            ? created.initialPromptError.message
            : String(created.initialPromptError),
      };
    }

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
}
