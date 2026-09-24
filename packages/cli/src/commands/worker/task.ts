import type { Command } from "commander";
import type { CommandError, CommandOptions, ListResult, SingleResult } from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import { workerTaskSchema, type WorkerTaskRow } from "./shared.js";

function toTaskRow(task: {
  taskId: string;
  workerId: string;
  title: string;
  state: string;
}): WorkerTaskRow {
  return {
    taskId: task.taskId,
    workerId: task.workerId,
    title: task.title,
    state: task.state,
  };
}

export interface WorkerTaskLsOptions extends CommandOptions {
  workerId?: string;
}

export interface WorkerTaskCreateOptions extends CommandOptions {
  workerId?: string;
  title?: string;
}

export async function runWorkerTaskLsCommand(
  options: WorkerTaskLsOptions,
  _command: Command,
): Promise<ListResult<WorkerTaskRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.listWorkerTasks(
      options.workerId !== undefined ? { workerId: options.workerId } : {},
    );
    return { type: "list", data: payload.tasks.map(toTaskRow), schema: workerTaskSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runWorkerTaskCreateCommand(
  options: WorkerTaskCreateOptions,
  _command: Command,
): Promise<SingleResult<WorkerTaskRow>> {
  const workerId = options.workerId?.trim();
  if (!workerId) {
    throw { code: "MISSING_WORKER_ID", message: "--worker-id is required" } satisfies CommandError;
  }
  const title = options.title?.trim();
  if (!title) {
    throw { code: "MISSING_TITLE", message: "--title is required" } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.createWorkerTask({ workerId, title });
    return { type: "single", data: toTaskRow(payload.task), schema: workerTaskSchema };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_TASK_CREATE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Run a task and wait for its outcome.
 *
 * Blocking is the point: the caller gets the state the task ended in. A run
 * that could not produce a result ends `blocked`, and that is reported as a
 * normal result rather than an error, because the task itself is the answer.
 */
export async function runWorkerTaskRunCommand(
  taskId: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<WorkerTaskRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.runWorkerTask(taskId);
    return { type: "single", data: toTaskRow(payload.task), schema: workerTaskSchema };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_TASK_RUN_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
