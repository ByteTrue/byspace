import type { Command } from "commander";
import type { CommandError, CommandOptions, SingleResult } from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import { toWorkerRow } from "./ls.js";
import { workerSchema, type WorkerRow } from "./shared.js";

export interface WorkerCreateOptions extends CommandOptions {
  name?: string;
  templateId?: string;
  workspacePath?: string;
}

export async function runWorkerCreateCommand(
  options: WorkerCreateOptions,
  _command: Command,
): Promise<SingleResult<WorkerRow>> {
  const name = options.name?.trim();
  if (!name) {
    throw { code: "MISSING_NAME", message: "--name is required" } satisfies CommandError;
  }
  const templateId = options.templateId?.trim();
  if (!templateId) {
    throw {
      code: "MISSING_TEMPLATE_ID",
      message: "--template-id is required",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.createWorker({
      name,
      templateId,
      ...(options.workspacePath !== undefined ? { workspacePath: options.workspacePath } : {}),
    });
    return { type: "single", data: toWorkerRow(payload.worker), schema: workerSchema };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_CREATE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
