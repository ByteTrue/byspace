import type { Command } from "commander";
import type { CommandOptions, ListResult } from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import { workerSchema, type WorkerRow } from "./shared.js";

export function toWorkerRow(worker: {
  id: string;
  name: string;
  templateId: string;
  status: string;
  workspacePath: string;
}): WorkerRow {
  return {
    workerId: worker.id,
    name: worker.name,
    templateId: worker.templateId,
    status: worker.status,
    workspacePath: worker.workspacePath,
  };
}

export async function runWorkerLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<WorkerRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.listWorkers();
    return {
      type: "list",
      data: payload.workers.map(toWorkerRow),
      schema: workerSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
