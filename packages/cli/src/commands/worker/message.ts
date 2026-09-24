import type { Command } from "commander";
import type {
  CommandError,
  CommandOptions,
  ListResult,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";

export interface WorkerMessageRow {
  seq: number;
  messageId: string;
  sender: string;
  policy: string;
  audience: string;
  body: string;
}

export const workerMessageSchema: OutputSchema<WorkerMessageRow> = {
  idField: "messageId",
  columns: [
    // The id is shown, not just carried as the row's id field: it is what
    // `--reply-to` and `goal mutate --result-message` take, so a caller has to
    // be able to read it off the output.
    { header: "SEQ", field: "seq", width: 5 },
    { header: "MESSAGE ID", field: "messageId", width: 20 },
    { header: "FROM", field: "sender", width: 18 },
    { header: "POLICY", field: "policy", width: 11 },
    { header: "TO", field: "audience", width: 22 },
    { header: "BODY", field: "body", width: 44 },
  ],
};

export interface WorkerInboxRow {
  state: string;
  seq: number;
  messageId: string;
  sender: string;
  body: string;
}

export const workerInboxSchema: OutputSchema<WorkerInboxRow> = {
  idField: "messageId",
  columns: [
    { header: "STATE", field: "state", width: 9 },
    { header: "SEQ", field: "seq", width: 5 },
    { header: "FROM", field: "sender", width: 18 },
    { header: "BODY", field: "body", width: 50 },
  ],
};

interface MessageLike {
  messageId: string;
  seq: number;
  senderWorkerId: string;
  body: string;
  deliveryPolicy: string;
  audience: string[];
}

export function toMessageRow(message: MessageLike): WorkerMessageRow {
  return {
    seq: message.seq,
    messageId: message.messageId,
    sender: message.senderWorkerId,
    policy: message.deliveryPolicy === "wake" ? "wakes" : "stores",
    audience: message.audience.length > 0 ? message.audience.join(" ") : "-",
    body: message.body,
  };
}

export interface MessageSendOptions extends CommandOptions {
  groupId?: string;
  senderWorkerId?: string;
  body?: string;
  mention?: string[];
  notMention?: boolean;
  privateTo?: string[];
  intent?: string;
  replyTo?: string;
}

/**
 * Send a message into a group's stream.
 *
 * `--mention` wakes the named workers; `--not-mention` stores the message
 * without waking anyone. They are exclusive because the reference product
 * treats them as two different sends, not two flags on one.
 *
 * Visibility is separate from waking: `--private-to` narrows who may read,
 * and it is orthogonal to whether anyone is woken.
 */
export async function runMessageSendCommand(
  options: MessageSendOptions,
  _command: Command,
): Promise<SingleResult<WorkerMessageRow>> {
  const groupId = options.groupId?.trim();
  if (!groupId) {
    throw { code: "MISSING_GROUP_ID", message: "--group-id is required" } satisfies CommandError;
  }
  const senderWorkerId = options.senderWorkerId?.trim();
  if (!senderWorkerId) {
    throw {
      code: "MISSING_SENDER",
      message: "--sender-worker-id is required",
    } satisfies CommandError;
  }
  const body = options.body?.trim();
  if (!body) {
    throw { code: "MISSING_BODY", message: "--body is required" } satisfies CommandError;
  }

  const mentions = options.mention ?? [];
  if (mentions.length > 0 && options.notMention) {
    throw {
      code: "CONFLICTING_FLAGS",
      message: "--mention and --not-mention are exclusive",
      details: "A message either wakes its audience or is stored without waking anyone.",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.sendWorkerMessage({
      groupId,
      senderWorkerId,
      body,
      ...(mentions.length > 0 ? { audience: mentions } : {}),
      ...(options.notMention ? { deliveryPolicy: "store_only" as const } : {}),
      ...(options.privateTo !== undefined ? { privateTo: options.privateTo } : {}),
      ...(options.intent !== undefined ? { intent: options.intent as never } : {}),
      ...(options.replyTo !== undefined ? { replyToMessageId: options.replyTo } : {}),
    });
    return {
      type: "single",
      data: toMessageRow(payload.message),
      schema: workerMessageSchema,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_MESSAGE_SEND_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface MessageListOptions extends CommandOptions {
  groupId?: string;
  viewerWorkerId?: string;
  limit?: string;
}

export async function runMessageListCommand(
  options: MessageListOptions,
  _command: Command,
): Promise<ListResult<WorkerMessageRow>> {
  const groupId = options.groupId?.trim();
  if (!groupId) {
    throw { code: "MISSING_GROUP_ID", message: "--group-id is required" } satisfies CommandError;
  }
  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw {
      code: "INVALID_LIMIT",
      message: "--limit must be a positive integer",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.listWorkerMessages({
      groupId,
      ...(options.viewerWorkerId !== undefined ? { viewerWorkerId: options.viewerWorkerId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return { type: "list", data: payload.messages.map(toMessageRow), schema: workerMessageSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface InboxListOptions extends CommandOptions {
  workerId?: string;
}

export async function runInboxListCommand(
  options: InboxListOptions,
  _command: Command,
): Promise<ListResult<WorkerInboxRow>> {
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
    const payload = await client.listWorkerInbox(workerId);
    return {
      type: "list",
      data: payload.entries.map((entry) => ({
        state: entry.state,
        seq: entry.message.seq,
        messageId: entry.message.messageId,
        sender: entry.message.senderWorkerId,
        body: entry.message.body,
      })),
      schema: workerInboxSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface MessageReadOptions extends CommandOptions {
  messageId?: string;
  workerId?: string;
}

/**
 * Mark a message picked up or finished for one worker.
 *
 * Reports when the worker had no delivery for it, which means the message was
 * not addressed to them — a normal answer, not a failure, so it is printed
 * rather than raised.
 */
export async function runMessageReadCommand(
  options: MessageReadOptions,
  _command: Command,
): Promise<SingleResult<{ messageId: string; state: string }>> {
  const messageId = options.messageId?.trim();
  if (!messageId) {
    throw {
      code: "MISSING_MESSAGE_ID",
      message: "--message-id is required",
    } satisfies CommandError;
  }
  const workerId = options.workerId?.trim();
  if (!workerId) {
    throw { code: "MISSING_WORKER_ID", message: "--worker-id is required" } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.markWorkerMessageDelivery({
      messageId,
      workerId,
      state: "read",
    });
    return {
      type: "single",
      data: { messageId, state: payload.marked ? "read" : "not-addressed" },
      schema: {
        idField: "messageId",
        columns: [
          { header: "MESSAGE ID", field: "messageId", width: 20 },
          { header: "RESULT", field: "state", width: 16 },
        ],
      },
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
