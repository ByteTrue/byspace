/**
 * Reading a worker's memory from the CLI.
 *
 * The operator's way to answer "what has this worker learned" without opening
 * its workspace directory. Read-only on purpose: the memory is the worker's own
 * document, written by the worker per the rules in its prompt, and an edit
 * command here would be a second author for a thing that is meant to have one.
 */
import type { Command } from "commander";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";

export interface WorkerMemoryRow {
  workerId: string;
  kind: string;
  day: string;
  body: string;
}

export const workerMemorySchema: OutputSchema<WorkerMemoryRow> = {
  idField: "body",
  columns: [
    { header: "KIND", field: "kind", width: 8 },
    { header: "DAY", field: "day", width: 12 },
    { header: "MEMORY", field: "body", width: 90 },
  ],
};

export async function runWorkerMemoryShowCommand(
  options: CommandOptions & { workerId?: string },
  _command: Command,
): Promise<
  | SingleResult<WorkerMemoryRow>
  | { type: "list"; data: WorkerMemoryRow[]; schema: OutputSchema<WorkerMemoryRow> }
> {
  const workerId = options.workerId?.trim();
  if (!workerId) {
    throw {
      code: "MISSING_WORKER_ID",
      message: "--worker-id is required",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.getWorkerMemory(workerId);
    const rows: WorkerMemoryRow[] = [];
    if (payload.memory !== null) {
      rows.push({ workerId, kind: "index", day: "-", body: payload.memory.trim() });
    }
    for (const note of payload.notes) {
      rows.push({ workerId, kind: "daily", day: note.day, body: note.body.trim() });
    }
    if (rows.length === 0) {
      // A worker that has not remembered anything is the normal first state,
      // and the empty result says so rather than erroring.
      return { type: "list", data: [], schema: workerMemorySchema };
    }
    return { type: "list", data: rows, schema: workerMemorySchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}
