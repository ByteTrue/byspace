/**
 * The multica CLI: the operator's terminal surface for the replica.
 *
 * Mirrors the reference product's command surface in shape (issue / agent /
 * squad / comment). The secretary is not a command: the owner chats with it
 * through the ordinary agent session of its standing workspace, and the
 * secretary itself drives these commands from inside its own session.
 */
import { Command } from "commander";
import {
  withOutput,
  type CommandError,
  type CommandOptions,
  type ListResult,
  type OutputSchema,
} from "../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../utils/client.js";
import { addJsonAndDaemonHostOptions } from "../utils/command-options.js";

export interface MulticaIssueRow {
  readonly number: number;
  readonly status: string;
  readonly title: string;
  readonly issueId: string;
}

export const multicaIssueSchema: OutputSchema<MulticaIssueRow> = {
  idField: "issueId",
  columns: [
    { header: "NUMBER", field: "number", width: 8 },
    { header: "STATUS", field: "status", width: 14 },
    { header: "TITLE", field: "title", width: 60 },
    { header: "ISSUE ID", field: "issueId", width: 20 },
  ],
};

export interface MulticaAgentRow {
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly description: string;
  readonly agentId: string;
}

export const multicaAgentSchema: OutputSchema<MulticaAgentRow> = {
  idField: "agentId",
  columns: [
    { header: "NAME", field: "name", width: 24 },
    { header: "KIND", field: "kind", width: 8 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "DESCRIPTION", field: "description", width: 52 },
    { header: "AGENT ID", field: "agentId", width: 20 },
  ],
};

export interface MulticaCommentRow {
  readonly author: string;
  readonly createdAt: string;
  readonly content: string;
  readonly commentId: string;
}

export interface MulticaWakeupRow {
  readonly id: string;
  readonly kind: string;
  readonly mode: string;
  readonly enabled: string;
  readonly agent: string;
  readonly next: string;
  readonly instruction: string;
}

export const multicaWakeupSchema: OutputSchema<MulticaWakeupRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 14 },
    { header: "KIND", field: "kind", width: 8 },
    { header: "MODE", field: "mode", width: 12 },
    { header: "ON", field: "enabled", width: 4 },
    { header: "AGENT", field: "agent", width: 10 },
    { header: "NEXT", field: "next", width: 24 },
    { header: "INSTRUCTION", field: "instruction", width: 40 },
  ],
};

export const multicaCommentSchema: OutputSchema<MulticaCommentRow> = {
  idField: "commentId",
  columns: [
    { header: "AUTHOR", field: "author", width: 18 },
    { header: "CONTENT", field: "content", width: 80 },
    { header: "COMMENT ID", field: "commentId", width: 20 },
  ],
};

export async function runMulticaIssueLsCommand(
  options: CommandOptions & { status?: string },
  _command: Command,
): Promise<ListResult<MulticaIssueRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaIssueList({ status: options.status });
    return {
      type: "list",
      data: payload.issues.map((issue) => ({
        number: issue.number ?? 0,
        status: issue.status,
        title: issue.title,
        issueId: issue.id,
      })),
      schema: multicaIssueSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaIssueCreateCommand(
  options: CommandOptions & {
    title?: string;
    description?: string;
    status?: string;
    assigneeId?: string;
    assigneeType?: string;
  },
  _command: Command,
): Promise<ListResult<MulticaIssueRow>> {
  const title = options.title?.trim();
  if (!title) {
    throw { code: "MISSING_TITLE", message: "--title is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaIssueCreate({
      title,
      description: options.description,
      status: options.status,
      assigneeId: options.assigneeId,
      assigneeType: options.assigneeType,
    });
    const issue = payload.issue;
    return {
      type: "list",
      data: [
        {
          number: issue.number ?? 0,
          status: issue.status,
          title: issue.title,
          issueId: issue.id,
        },
      ],
      schema: multicaIssueSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaAgentLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<MulticaAgentRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaAgentList();
    return {
      type: "list",
      data: payload.agents.map((agent) => ({
        name: agent.name,
        kind: agent.kind,
        status: agent.status,
        description: agent.description,
        agentId: agent.id,
      })),
      schema: multicaAgentSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaCommentLsCommand(
  options: CommandOptions & { issueId?: string },
  _command: Command,
): Promise<ListResult<MulticaCommentRow>> {
  const issueId = options.issueId?.trim();
  if (!issueId) {
    throw { code: "MISSING_ISSUE_ID", message: "--issue-id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaCommentList(issueId);
    return {
      type: "list",
      data: payload.comments.map((comment) => ({
        author: comment.authorType === "owner" ? "you" : comment.authorId,
        createdAt: comment.createdAt,
        content: comment.content,
        commentId: comment.id,
      })),
      schema: multicaCommentSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaCommentSendCommand(
  options: CommandOptions & { issueId?: string; body?: string },
  _command: Command,
): Promise<ListResult<MulticaCommentRow>> {
  const issueId = options.issueId?.trim();
  if (!issueId) {
    throw { code: "MISSING_ISSUE_ID", message: "--issue-id is required" } satisfies CommandError;
  }
  const body = options.body?.trim();
  if (!body) {
    throw { code: "MISSING_BODY", message: "--body is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    // Speaking from inside an agent session means speaking as that run: the
    // session id rides the request so the daemon attributes the comment to
    // the run's agent. The daemon refuses ids it cannot resolve to a run, so
    // a forged id fails loudly instead of attributing wrongly.
    const senderSessionId = process.env.BYSPACE_AGENT_ID?.trim() || undefined;
    const payload = await client.multicaCommentCreate({
      issueId,
      content: body,
      ...(senderSessionId ? { senderSessionId } : {}),
    });
    return {
      type: "list",
      data: [
        {
          author: payload.comment.authorType === "owner" ? "you" : payload.comment.authorId,
          createdAt: payload.comment.createdAt,
          content: payload.comment.content,
          commentId: payload.comment.id,
        },
      ],
      schema: multicaCommentSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaAgentCreateCommand(
  options: CommandOptions & { name?: string; description?: string; instructions?: string },
  _command: Command,
): Promise<ListResult<MulticaAgentRow>> {
  const name = options.name?.trim();
  if (!name) {
    throw { code: "MISSING_NAME", message: "--name is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaAgentCreate({
      name,
      description: options.description,
      instructions: options.instructions,
    });
    const created = payload.agent;
    return {
      type: "list",
      data: [
        {
          name: created.name,
          kind: created.kind,
          status: created.status,
          description: created.description,
          agentId: created.id,
        },
      ],
      schema: multicaAgentSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function createMulticaCommand(): Command {
  const multica = new Command("multica").description("The issue-centric workspace");

  const issue = multica.command("issue").description("Issues");
  addJsonAndDaemonHostOptions(
    issue
      .command("ls")
      .description("List issues")
      .option("--status <status>", "Filter by status key")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaIssueLsCommand));

  addJsonAndDaemonHostOptions(
    issue
      .command("create")
      .description("Create an issue")
      .requiredOption("--title <title>", "Issue title")
      .option("--description <text>", "Issue description")
      .option("--status <key>", "Initial status (default backlog)")
      .option("--assignee-id <id>", "Assignee id")
      .option("--assignee-type <type>", "agent | squad")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaIssueCreateCommand));

  const wakeup = issue.command("wakeup").description("Wakeup subscriptions on an issue");
  addJsonAndDaemonHostOptions(
    wakeup
      .command("ls")
      .description("List an issue's wakeup subscriptions")
      .requiredOption("--issue-id <id>", "Issue id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaWakeupLsCommand));
  addJsonAndDaemonHostOptions(
    wakeup
      .command("create")
      .description("Register a wakeup (event|at|every|cron) on an issue")
      .requiredOption("--issue-id <id>", "Issue id")
      .requiredOption("--agent-id <id>", "Agent to wake")
      .requiredOption("--instruction <text>", "What to do when woken")
      .requiredOption("--kind <kind>", "event | at | every | cron")
      .option("--mode <mode>", "once | continuous (default continuous)")
      .option("--events <list>", "Comma-separated event types (event kind)")
      .option("--every-seconds <n>", "Interval (every kind)")
      .option("--cron <expr>", "Cron expression (cron kind)")
      .option("--timezone <tz>", "Timezone for cron (default UTC)")
      .option("--at <iso>", "One-shot fire time (at kind)")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaWakeupCreateCommand));
  addJsonAndDaemonHostOptions(
    wakeup
      .command("disable")
      .description("Retire a wakeup subscription")
      .requiredOption("--issue-id <id>", "Issue id")
      .requiredOption("--id <id>", "Wakeup id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaWakeupDisableCommand));

  const agent = multica.command("agent").description("Agents");
  addJsonAndDaemonHostOptions(
    agent.command("ls").description("List agents").allowExcessArguments(false),
  ).action(withOutput(runMulticaAgentLsCommand));
  addJsonAndDaemonHostOptions(
    agent
      .command("create")
      .description("Create an agent")
      .requiredOption("--name <name>", "Agent name")
      .option("--description <text>", "Agent description")
      .option("--instructions <text>", "Agent instructions")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaAgentCreateCommand));

  const comment = multica.command("comment").description("Comments on an issue");
  addJsonAndDaemonHostOptions(
    comment
      .command("ls")
      .description("List an issue's comments")
      .requiredOption("--issue-id <id>", "Issue to read")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaCommentLsCommand));

  addJsonAndDaemonHostOptions(
    comment
      .command("send")
      .description("Comment on an issue (wakes @mentions and the assignee)")
      .requiredOption("--issue-id <id>", "Issue to comment on")
      .requiredOption("--body <text>", "Comment body")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaCommentSendCommand));

  return multica;
}

export async function runMulticaWakeupLsCommand(
  options: CommandOptions & { issueId?: string },
  _command: Command,
): Promise<ListResult<MulticaWakeupRow>> {
  const issueId = options.issueId?.trim();
  if (!issueId) {
    throw { code: "MISSING_ISSUE_ID", message: "--issue-id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaWakeupList(issueId);
    return {
      type: "list",
      data: payload.wakeups.map((wakeup) => ({
        id: wakeup.id,
        kind: wakeup.kind,
        mode: wakeup.mode,
        enabled: wakeup.enabled ? "yes" : "no",
        agent: wakeup.agentId.slice(0, 8),
        next: wakeup.nextFireAt ?? "-",
        instruction: wakeup.instruction.slice(0, 60),
      })),
      schema: multicaWakeupSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaWakeupCreateCommand(
  options: CommandOptions & {
    issueId?: string;
    agentId?: string;
    instruction?: string;
    kind?: string;
    mode?: string;
    events?: string;
    everySeconds?: string;
    cron?: string;
    timezone?: string;
    at?: string;
  },
  _command: Command,
): Promise<ListResult<MulticaWakeupRow>> {
  const issueId = options.issueId?.trim();
  const agentId = options.agentId?.trim();
  const instruction = options.instruction?.trim();
  const kind = options.kind?.trim();
  if (!issueId || !agentId || !instruction || !kind) {
    throw {
      code: "MISSING_ARGS",
      message: "--issue-id, --agent-id, --instruction and --kind are required",
    } satisfies CommandError;
  }
  const parsedKind = parseWakeupKind(kind);
  const mode = parseWakeupMode(options.mode);
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    // Registering from inside a run: the session rides the request so the
    // subscription records which run asked for it — the self-trigger guard
    // reads that back.
    const senderSessionId = process.env.BYSPACE_AGENT_ID?.trim() || undefined;
    const payload = await client.multicaWakeupCreate({
      issueId,
      agentId,
      instruction,
      kind: parsedKind,
      mode,
      ...wakeupOptionalFields(options),
      ...(senderSessionId ? { senderSessionId } : {}),
    });
    return {
      type: "list",
      data: [
        {
          id: payload.wakeup.id,
          kind: payload.wakeup.kind,
          mode: payload.wakeup.mode,
          enabled: payload.wakeup.enabled ? "yes" : "no",
          agent: payload.wakeup.agentId.slice(0, 8),
          next: payload.wakeup.nextFireAt ?? "-",
          instruction: payload.wakeup.instruction.slice(0, 60),
        },
      ],
      schema: multicaWakeupSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaWakeupDisableCommand(
  options: CommandOptions & { issueId?: string; id?: string },
  _command: Command,
): Promise<ListResult<MulticaWakeupRow>> {
  const issueId = options.issueId?.trim();
  const id = options.id?.trim();
  if (!issueId || !id) {
    throw {
      code: "MISSING_ARGS",
      message: "--issue-id and --id are required",
    } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaWakeupDisable({ issueId, id });
    return {
      type: "list",
      data: [
        {
          id: payload.wakeup.id,
          kind: payload.wakeup.kind,
          mode: payload.wakeup.mode,
          enabled: payload.wakeup.enabled ? "yes" : "no",
          agent: payload.wakeup.agentId.slice(0, 8),
          next: payload.wakeup.nextFireAt ?? "-",
          instruction: payload.wakeup.instruction.slice(0, 60),
        },
      ],
      schema: multicaWakeupSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function parseWakeupKind(kind: string): "event" | "at" | "every" | "cron" {
  if (kind === "event" || kind === "at" || kind === "every" || kind === "cron") {
    return kind;
  }
  throw { code: "BAD_KIND", message: "--kind must be event|at|every|cron" } satisfies CommandError;
}

function parseWakeupMode(mode: string | undefined): "once" | "continuous" {
  const value = mode?.trim() ?? "continuous";
  if (value === "once" || value === "continuous") {
    return value;
  }
  throw { code: "BAD_MODE", message: "--mode must be once|continuous" } satisfies CommandError;
}

function wakeupOptionalFields(options: {
  events?: string;
  everySeconds?: string;
  cron?: string;
  timezone?: string;
  at?: string;
}): {
  eventTypes?: string[];
  intervalSeconds?: number;
  cronExpression?: string;
  timezone?: string;
  at?: string;
} {
  return {
    ...(options.events
      ? {
          eventTypes: options.events
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        }
      : {}),
    ...(options.everySeconds ? { intervalSeconds: Number(options.everySeconds) } : {}),
    ...(options.cron ? { cronExpression: options.cron } : {}),
    ...(options.timezone ? { timezone: options.timezone } : {}),
    ...(options.at ? { at: options.at } : {}),
  };
}
