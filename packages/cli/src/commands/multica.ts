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
    parent?: string;
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
      ...(options.parent ? { parentIssueId: options.parent.trim() } : {}),
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
  options: CommandOptions & { issueId?: string; body?: string; mention?: string | string[] },
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
  const mentionMarkup = await mentionMarkupFor(options.mention, options.host);
  const content = mentionMarkup === "" ? body : `${mentionMarkup} ${body}`;
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
      content,
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
      .option("--parent <id>", "Parent issue id (makes this a sub-issue)")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaIssueCreateCommand));

  addJsonAndDaemonHostOptions(
    issue
      .command("update")
      .description("Update an issue's fields (status, priority, assignee, title, position)")
      .requiredOption("--id <id>", "Issue id")
      .option("--status <key>", "New status key")
      .option("--priority <p>", "New priority")
      .option("--assignee-id <id>", "New assignee id (with --assignee-type)")
      .option("--assignee-type <type>", "agent | squad (with --assignee-id)")
      .option("--clear-assignee", "Unassign")
      .option("--title <title>", "New title")
      .option("--position <n>", "Drop slot (drag semantics)")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaIssueUpdateCommand));

  addJsonAndDaemonHostOptions(
    issue
      .command("status")
      .description("Move an issue's status")
      .requiredOption("--id <id>", "Issue id")
      .requiredOption("--status <key>", "Target status key")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaIssueStatusCommand));

  addJsonAndDaemonHostOptions(
    issue
      .command("timeline")
      .description("The issue's merged record: activities and comments")
      .requiredOption("--id <id>", "Issue id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaTimelineCommand));

  const squad = multica.command("squad").description("Squads: rosters with a leader");
  addJsonAndDaemonHostOptions(
    squad.command("ls").description("List squads").allowExcessArguments(false),
  ).action(withOutput(runMulticaSquadLsCommand));
  addJsonAndDaemonHostOptions(
    squad
      .command("get")
      .description("One squad with its roster")
      .requiredOption("--id <id>", "Squad id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaSquadGetCommand));
  addJsonAndDaemonHostOptions(
    squad
      .command("add-member")
      .description("Add a member to a squad")
      .requiredOption("--squad <id>", "Squad id")
      .requiredOption("--member <id>", "Member (agent) id")
      .option("--role <role>", "Member role (default member)")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaSquadAddMemberCommand));
  addJsonAndDaemonHostOptions(
    squad
      .command("remove-member")
      .description("Remove a member from a squad")
      .requiredOption("--squad <id>", "Squad id")
      .requiredOption("--member <id>", "Member (agent) id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaSquadRemoveMemberCommand));

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

  const autopilot = multica.command("autopilot").description("Declarative recurring work");
  addJsonAndDaemonHostOptions(
    autopilot.command("ls").description("List autopilots").allowExcessArguments(false),
  ).action(withOutput(runMulticaAutopilotLsCommand));
  addJsonAndDaemonHostOptions(
    autopilot
      .command("create")
      .description("Create an autopilot (optionally with a cron schedule trigger)")
      .requiredOption("--title <title>", "Autopilot title")
      .option("--description <text>", "The brief each run carries")
      .requiredOption("--assignee-type <type>", "agent | squad")
      .requiredOption("--assignee-id <id>", "Who runs it")
      .requiredOption("--mode <mode>", "create_issue | run_only")
      .option("--issue-title-template <tpl>", "Template for created issues ({{date}})")
      .option("--concurrency <policy>", "skip | queue (default skip)")
      .option("--cron <expr>", "Schedule trigger (cron)")
      .option("--timezone <tz>", "Timezone for the cron (default UTC)")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaAutopilotCreateCommand));
  addJsonAndDaemonHostOptions(
    autopilot
      .command("trigger")
      .description("Fire an autopilot now")
      .requiredOption("--id <id>", "Autopilot id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaAutopilotTriggerCommand));
  addJsonAndDaemonHostOptions(
    autopilot
      .command("pause")
      .description("Pause an autopilot")
      .requiredOption("--id <id>", "Autopilot id")
      .option("--reason <text>", "Why")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaAutopilotStatusCommand.bind(null, "paused")));
  addJsonAndDaemonHostOptions(
    autopilot
      .command("enable")
      .description("Resume a paused autopilot")
      .requiredOption("--id <id>", "Autopilot id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaAutopilotStatusCommand.bind(null, "active")));
  addJsonAndDaemonHostOptions(
    autopilot
      .command("archive")
      .description("Retire an autopilot")
      .requiredOption("--id <id>", "Autopilot id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaAutopilotStatusCommand.bind(null, "archived")));
  addJsonAndDaemonHostOptions(
    autopilot
      .command("runs")
      .description("An autopilot's run history")
      .requiredOption("--id <id>", "Autopilot id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaAutopilotRunsCommand));

  const inbox = multica.command("inbox").description("The owner's action inbox");
  addJsonAndDaemonHostOptions(
    inbox
      .command("ls")
      .description("List inbox items (unread first face: the live queue)")
      .option("--archived", "List archived items instead")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaInboxLsCommand));
  addJsonAndDaemonHostOptions(
    inbox
      .command("read")
      .description("Mark an item read (or --unread to undo)")
      .requiredOption("--id <id>", "Inbox item id")
      .option("--unread", "Mark unread instead of read")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaInboxReadCommand));
  addJsonAndDaemonHostOptions(
    inbox
      .command("archive")
      .description("Archive an item (or --unarchive)")
      .requiredOption("--id <id>", "Inbox item id")
      .option("--unarchive", "Unarchive instead")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaInboxArchiveCommand));
  addJsonAndDaemonHostOptions(
    inbox
      .command("create")
      .description("Escalate to the owner (run sessions only)")
      .requiredOption("--severity <s>", "action_required | attention | info")
      .requiredOption("--title <text>", "One-line summary for the owner")
      .option("--body <text>", "Detail")
      .option("--issue-id <id>", "Issue this concerns")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaInboxCreateCommand));
  addJsonAndDaemonHostOptions(
    inbox
      .command("archive-all")
      .description("Archive every live item (--read-only: only the read ones)")
      .option("--read-only", "Archive only items already read")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaInboxArchiveAllCommand));
  addJsonAndDaemonHostOptions(
    inbox
      .command("read-all")
      .description("Mark every unread item read")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaInboxReadAllCommand));

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
      .description("Comment on an issue (wakes mentions and the assignee)")
      .requiredOption("--issue-id <id>", "Issue to comment on")
      .requiredOption("--body <text>", "Comment body")
      .option(
        "--mention <name>",
        "Wake an agent or squad by name (repeatable; emits the source's mention markup)",
      )
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaCommentSendCommand));

  const label = multica.command("label").description("The label directory");
  addJsonAndDaemonHostOptions(
    label.command("ls").description("List the directory").allowExcessArguments(false),
  ).action(withOutput(runMulticaLabelLsCommand));
  addJsonAndDaemonHostOptions(
    label
      .command("create")
      .description("Create a label")
      .requiredOption("--name <name>", "Label name")
      .option("--color <color>", "Hex color", "#888888")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaLabelCreateCommand));
  addJsonAndDaemonHostOptions(
    label
      .command("update")
      .description("Rename or recolor a label (omit a field to keep it)")
      .requiredOption("--id <id>", "Label id")
      .option("--name <name>", "New name")
      .option("--color <color>", "New color")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaLabelUpdateCommand));
  addJsonAndDaemonHostOptions(
    label
      .command("delete")
      .description("Delete a label; its attachments go with it")
      .requiredOption("--id <id>", "Label id")
      .allowExcessArguments(false),
  ).action(withOutput(runMulticaLabelDeleteCommand));

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

export async function runMulticaInboxLsCommand(
  options: CommandOptions & { archived?: boolean },
  _command: Command,
): Promise<ListResult<MulticaInboxRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaInboxList({
      archived: options.archived === true,
      ...ownerCaller(),
    });
    return {
      type: "list",
      data: payload.items.map((item) => ({
        id: item.id,
        severity: item.severity,
        read: item.read ? "read" : "unread",
        title: item.title,
        issue: item.issueId ? item.issueId.slice(0, 8) : "-",
        actor: item.actorId ? item.actorId.slice(0, 8) : "-",
      })),
      schema: multicaInboxSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaInboxReadCommand(
  options: CommandOptions & { id?: string; unread?: boolean },
  _command: Command,
): Promise<ListResult<MulticaInboxRow>> {
  const id = options.id?.trim();
  if (!id) {
    throw { code: "MISSING_ID", message: "--id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaInboxMark({
      id,
      ...ownerCaller(),
      read: options.unread !== true,
    });
    return { type: "list", data: [inboxRow(payload.item)], schema: multicaInboxSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaInboxArchiveCommand(
  options: CommandOptions & { id?: string; unarchive?: boolean },
  _command: Command,
): Promise<ListResult<MulticaInboxRow>> {
  const id = options.id?.trim();
  if (!id) {
    throw { code: "MISSING_ID", message: "--id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaInboxArchive({
      id,
      ...ownerCaller(),
      archived: options.unarchive !== true,
    });
    return { type: "list", data: [inboxRow(payload.item)], schema: multicaInboxSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaInboxArchiveAllCommand(
  options: CommandOptions & { readOnly?: boolean },
  _command: Command,
): Promise<ListResult<{ changed: string }>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaInboxArchiveAll({
      ...(options.readOnly === true ? { readOnly: true } : {}),
      ...ownerCaller(),
    });
    return {
      type: "list",
      data: [{ changed: String(payload.changed) }],
      schema: {
        idField: "changed",
        columns: [{ header: "CHANGED", field: "changed", width: 10 }],
      },
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaInboxReadAllCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<{ changed: string }>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaInboxMarkAll({ ...ownerCaller() });
    return {
      type: "list",
      data: [{ changed: String(payload.changed) }],
      schema: {
        idField: "changed",
        columns: [{ header: "MARKED READ", field: "changed", width: 12 }],
      },
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

interface MulticaLabelRow {
  id: string;
  name: string;
  color: string;
}

const multicaLabelSchema: OutputSchema<MulticaLabelRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 10 },
    { header: "NAME", field: "name", width: 24 },
    { header: "COLOR", field: "color", width: 10 },
  ],
};

interface MulticaInboxRow {
  readonly id: string;
  readonly severity: string;
  readonly read: string;
  readonly title: string;
  readonly issue: string;
  readonly actor: string;
}

function inboxRow(item: {
  id: string;
  severity: string;
  read: boolean;
  title: string;
  issueId: string | null;
  actorId: string | null;
}): MulticaInboxRow {
  return {
    id: item.id,
    severity: item.severity,
    read: item.read ? "read" : "unread",
    title: item.title,
    issue: item.issueId ? item.issueId.slice(0, 8) : "-",
    actor: item.actorId ? item.actorId.slice(0, 8) : "-",
  };
}

const multicaInboxSchema: OutputSchema<MulticaInboxRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 14 },
    { header: "SEVERITY", field: "severity", width: 16 },
    { header: "READ", field: "read", width: 8 },
    { header: "TITLE", field: "title", width: 50 },
    { header: "ISSUE", field: "issue", width: 10 },
    { header: "ACTOR", field: "actor", width: 10 },
  ],
};

export async function runMulticaInboxCreateCommand(
  options: CommandOptions & {
    severity?: string;
    title?: string;
    body?: string;
    issueId?: string;
  },
  _command: Command,
): Promise<ListResult<MulticaInboxRow>> {
  const severity = options.severity?.trim();
  const title = options.title?.trim();
  if (!severity || !title) {
    throw {
      code: "MISSING_ARGS",
      message: "--severity and --title are required",
    } satisfies CommandError;
  }
  if (!["action_required", "attention", "info"].includes(severity)) {
    throw {
      code: "BAD_SEVERITY",
      message: "--severity must be action_required|attention|info",
    } satisfies CommandError;
  }
  // The inbox is the owner's desk; only a run may put something on it, and
  // the session is the proof. Outside a run there is nothing to prove with.
  const senderSessionId = process.env.BYSPACE_AGENT_ID?.trim();
  if (!senderSessionId) {
    throw {
      code: "NOT_A_RUN",
      message: "inbox create is for runs: it needs the session identity the daemon injects",
    } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaInboxCreate({
      severity: severity as "action_required" | "attention" | "info",
      title,
      senderSessionId,
      ...(options.body ? { body: options.body } : {}),
      ...(options.issueId ? { issueId: options.issueId.trim() } : {}),
    });
    return { type: "list", data: [inboxRow(payload.item)], schema: multicaInboxSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaAutopilotLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<MulticaAutopilotRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaAutopilotList();
    return {
      type: "list",
      data: payload.autopilots.map((autopilot) => ({
        id: autopilot.id,
        title: autopilot.title,
        mode: autopilot.executionMode,
        status: autopilot.status,
        assignee: autopilot.assigneeId.slice(0, 8),
        schedule:
          autopilot.triggers.find((trigger) => trigger.kind === "schedule")?.cronExpression ?? "-",
        lastRun: autopilot.lastRunAt ?? "-",
      })),
      schema: multicaAutopilotSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaAutopilotCreateCommand(
  options: CommandOptions & {
    title?: string;
    description?: string;
    assigneeType?: string;
    assigneeId?: string;
    mode?: string;
    issueTitleTemplate?: string;
    concurrency?: string;
    cron?: string;
    timezone?: string;
  },
  _command: Command,
): Promise<ListResult<MulticaAutopilotRow>> {
  const parsed = parseAutopilotCreateOptions(options);
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaAutopilotCreate({
      title: parsed.title,
      assigneeType: parsed.assigneeType,
      assigneeId: parsed.assigneeId,
      executionMode: parsed.mode,
      concurrencyPolicy: parsed.concurrency,
      ...(options.description ? { description: options.description } : {}),
      ...(options.issueTitleTemplate ? { issueTitleTemplate: options.issueTitleTemplate } : {}),
      ...(options.cron ? { cron: options.cron } : {}),
      ...(options.timezone ? { timezone: options.timezone } : {}),
    });
    const autopilot = payload.autopilot;
    return {
      type: "list",
      data: [
        {
          id: autopilot.id,
          title: autopilot.title,
          mode: autopilot.executionMode,
          status: autopilot.status,
          assignee: autopilot.assigneeId.slice(0, 8),
          schedule:
            autopilot.triggers.find((trigger) => trigger.kind === "schedule")?.cronExpression ??
            "-",
          lastRun: autopilot.lastRunAt ?? "-",
        },
      ],
      schema: multicaAutopilotSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaAutopilotTriggerCommand(
  options: CommandOptions & { id?: string },
  _command: Command,
): Promise<ListResult<MulticaAutopilotRunRow>> {
  const id = options.id?.trim();
  if (!id) {
    throw { code: "MISSING_ID", message: "--id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaAutopilotTrigger(id);
    return {
      type: "list",
      data: [runRow(payload.run, payload.fired, payload.reason)],
      schema: multicaAutopilotRunSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaAutopilotRunsCommand(
  options: CommandOptions & { id?: string },
  _command: Command,
): Promise<ListResult<MulticaAutopilotRunRow>> {
  const id = options.id?.trim();
  if (!id) {
    throw { code: "MISSING_ID", message: "--id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaAutopilotRuns(id);
    return {
      type: "list",
      data: payload.runs.map((run) => runRow(run, run.status !== "skipped", null)),
      schema: multicaAutopilotRunSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

interface MulticaAutopilotRow {
  readonly id: string;
  readonly title: string;
  readonly mode: string;
  readonly status: string;
  readonly assignee: string;
  readonly schedule: string;
  readonly lastRun: string;
}

interface MulticaAutopilotRunRow {
  readonly id: string;
  readonly source: string;
  readonly status: string;
  readonly fired: string;
  readonly issue: string;
  readonly reason: string;
}

function runRow(
  run: {
    id: string;
    source: string;
    status: string;
    issueId: string | null;
  },
  fired: boolean,
  reason: string | null,
): MulticaAutopilotRunRow {
  return {
    id: run.id,
    source: run.source,
    status: run.status,
    fired: fired ? "yes" : "no",
    issue: run.issueId ? run.issueId.slice(0, 8) : "-",
    reason: reason ?? "-",
  };
}

const multicaAutopilotSchema: OutputSchema<MulticaAutopilotRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 14 },
    { header: "TITLE", field: "title", width: 30 },
    { header: "MODE", field: "mode", width: 14 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "ASSIGNEE", field: "assignee", width: 10 },
    { header: "SCHEDULE", field: "schedule", width: 16 },
    { header: "LAST RUN", field: "lastRun", width: 24 },
  ],
};

const multicaAutopilotRunSchema: OutputSchema<MulticaAutopilotRunRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 14 },
    { header: "SOURCE", field: "source", width: 10 },
    { header: "STATUS", field: "status", width: 14 },
    { header: "FIRED", field: "fired", width: 6 },
    { header: "ISSUE", field: "issue", width: 10 },
    { header: "REASON", field: "reason", width: 40 },
  ],
};

function parseAutopilotCreateOptions(options: {
  title?: string;
  assigneeType?: string;
  assigneeId?: string;
  mode?: string;
  concurrency?: string;
}): {
  title: string;
  assigneeType: "agent" | "squad";
  assigneeId: string;
  mode: "create_issue" | "run_only";
  concurrency: "skip" | "queue";
} {
  const title = options.title?.trim();
  const assigneeId = options.assigneeId?.trim();
  const assigneeType = options.assigneeType?.trim();
  const mode = options.mode?.trim();
  if (!title || !assigneeId || !assigneeType || !mode) {
    throw {
      code: "MISSING_ARGS",
      message: "--title, --assignee-type, --assignee-id and --mode are required",
    } satisfies CommandError;
  }
  if (assigneeType !== "agent" && assigneeType !== "squad") {
    throw {
      code: "BAD_ASSIGNEE",
      message: "--assignee-type must be agent|squad",
    } satisfies CommandError;
  }
  if (mode !== "create_issue" && mode !== "run_only") {
    throw {
      code: "BAD_MODE",
      message: "--mode must be create_issue|run_only",
    } satisfies CommandError;
  }
  const concurrency = options.concurrency?.trim() ?? "skip";
  if (concurrency !== "skip" && concurrency !== "queue") {
    throw {
      code: "BAD_POLICY",
      message: "--concurrency must be skip|queue",
    } satisfies CommandError;
  }
  return { title, assigneeType, assigneeId, mode, concurrency };
}

export async function runMulticaAutopilotStatusCommand(
  status: "active" | "paused" | "archived",
  options: CommandOptions & { id?: string; reason?: string },
  _command: Command,
): Promise<ListResult<MulticaAutopilotRow>> {
  const id = options.id?.trim();
  if (!id) {
    throw { code: "MISSING_ID", message: "--id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaAutopilotStatus({
      id,
      status,
      ...(options.reason ? { pauseReason: options.reason } : {}),
    });
    const autopilot = payload.autopilot;
    return {
      type: "list",
      data: [
        {
          id: autopilot.id,
          title: autopilot.title,
          mode: autopilot.executionMode,
          status: autopilot.status,
          assignee: autopilot.assigneeId.slice(0, 8),
          schedule:
            autopilot.triggers.find((trigger) => trigger.kind === "schedule")?.cronExpression ??
            "-",
          lastRun: autopilot.lastRunAt ?? "-",
        },
      ],
      schema: multicaAutopilotSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaIssueUpdateCommand(
  options: CommandOptions & {
    id?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    assigneeType?: string;
    clearAssignee?: boolean;
    title?: string;
    position?: string;
  },
  _command: Command,
): Promise<ListResult<MulticaIssueWriteRow>> {
  const id = requireArg(options.id, "--id");
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const current = (await client.multicaIssueGet(id)).issue;
    const senderSessionId = process.env.BYSPACE_AGENT_ID?.trim() || undefined;
    const position = options.position !== undefined ? Number(options.position) : undefined;
    const payload = await client.multicaIssueUpdate({
      issueId: id,
      expectedRevision: current.revision,
      ...(options.status ? { status: options.status } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(position !== undefined && !Number.isNaN(position) ? { position } : {}),
      ...assigneePatchFromOptions(options),
      ...(senderSessionId ? { senderSessionId } : {}),
    });
    return { type: "list", data: [issueRow(payload.issue)], schema: multicaIssueWriteSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaIssueStatusCommand(
  options: CommandOptions & { id?: string; status?: string },
  _command: Command,
): Promise<ListResult<MulticaIssueWriteRow>> {
  const id = requireArg(options.id, "--id");
  const status = requireArg(options.status, "--status");
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const current = (await client.multicaIssueGet(id)).issue;
    const senderSessionId = process.env.BYSPACE_AGENT_ID?.trim() || undefined;
    const payload = await client.multicaIssueStatusUpdate({
      issueId: id,
      status,
      expectedRevision: current.revision,
      ...(senderSessionId ? { senderSessionId } : {}),
    });
    return { type: "list", data: [issueRow(payload.issue)], schema: multicaIssueWriteSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaTimelineCommand(
  options: CommandOptions & { id?: string },
  _command: Command,
): Promise<ListResult<MulticaTimelineRow>> {
  const id = requireArg(options.id, "--id");
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaTimelineList(id);
    return {
      type: "list",
      data: payload.entries.map((entry) => ({
        at: entry.createdAt,
        kind: entry.kind,
        who: entry.kind === "comment" ? (entry.authorType ?? "-") : (entry.actorType ?? "-"),
        what:
          entry.kind === "comment"
            ? (entry.content ?? "").slice(0, 60)
            : `${entry.action ?? "-"}${
                entry.details &&
                typeof entry.details.from === "string" &&
                typeof entry.details.to === "string"
                  ? ` ${entry.details.from}→${entry.details.to}`
                  : ""
              }`,
      })),
      schema: multicaTimelineSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaSquadLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<MulticaSquadRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaSquadList();
    return {
      type: "list",
      data: payload.squads.map((squad) => ({
        id: squad.id,
        name: squad.name,
        leader: squad.leaderId.slice(0, 8),
        description: squad.description.slice(0, 40),
      })),
      schema: multicaSquadSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaSquadGetCommand(
  options: CommandOptions & { id?: string },
  _command: Command,
): Promise<ListResult<MulticaSquadMemberRow>> {
  const id = requireArg(options.id, "--id");
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaSquadGet(id);
    return {
      type: "list",
      data: payload.squad.members.map((member) => ({
        member: member.memberId.slice(0, 8),
        type: member.memberType,
        role: member.role,
        leader: member.memberId === payload.squad.leaderId ? "yes" : "no",
      })),
      schema: multicaSquadMemberSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaSquadAddMemberCommand(
  options: CommandOptions & { squad?: string; member?: string; role?: string },
  _command: Command,
): Promise<ListResult<MulticaSquadMemberRow>> {
  const squadId = requireArg(options.squad, "--squad");
  const memberId = requireArg(options.member, "--member");
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaSquadAddMember({
      squadId,
      memberType: "agent",
      memberId,
      ...(options.role ? { role: options.role } : {}),
    });
    return {
      type: "list",
      data: payload.squad.members.map((member) => ({
        member: member.memberId.slice(0, 8),
        type: member.memberType,
        role: member.role,
        leader: member.memberId === payload.squad.leaderId ? "yes" : "no",
      })),
      schema: multicaSquadMemberSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaSquadRemoveMemberCommand(
  options: CommandOptions & { squad?: string; member?: string },
  _command: Command,
): Promise<ListResult<MulticaSquadMemberRow>> {
  const squadId = requireArg(options.squad, "--squad");
  const memberId = requireArg(options.member, "--member");
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaSquadRemoveMember({
      squadId,
      memberType: "agent",
      memberId,
    });
    return {
      type: "list",
      data: payload.squad.members.map((member) => ({
        member: member.memberId.slice(0, 8),
        type: member.memberType,
        role: member.role,
        leader: member.memberId === payload.squad.leaderId ? "yes" : "no",
      })),
      schema: multicaSquadMemberSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

interface MulticaIssueWriteRow {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: string;
  readonly assignee: string;
}

interface MulticaTimelineRow {
  readonly at: string;
  readonly kind: string;
  readonly who: string;
  readonly what: string;
}

interface MulticaSquadRow {
  readonly id: string;
  readonly name: string;
  readonly leader: string;
  readonly description: string;
}

interface MulticaSquadMemberRow {
  readonly member: string;
  readonly type: string;
  readonly role: string;
  readonly leader: string;
}

function issueRow(issue: {
  id: string;
  number: number | null;
  title: string;
  status: string;
  assigneeId: string | null;
}): MulticaIssueWriteRow {
  return {
    id: issue.id,
    number: issue.number === null ? "-" : String(issue.number),
    title: issue.title.slice(0, 48),
    status: issue.status,
    assignee: issue.assigneeId ? issue.assigneeId.slice(0, 8) : "-",
  };
}

function requireArg(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw { code: "MISSING_ARG", message: `${flag} is required` } satisfies CommandError;
  }
  return trimmed;
}

const multicaIssueWriteSchema: OutputSchema<MulticaIssueWriteRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 14 },
    { header: "#", field: "number", width: 5 },
    { header: "TITLE", field: "title", width: 48 },
    { header: "STATUS", field: "status", width: 14 },
    { header: "ASSIGNEE", field: "assignee", width: 10 },
  ],
};

const multicaTimelineSchema: OutputSchema<MulticaTimelineRow> = {
  idField: "at",
  columns: [
    { header: "AT", field: "at", width: 26 },
    { header: "KIND", field: "kind", width: 10 },
    { header: "WHO", field: "who", width: 10 },
    { header: "WHAT", field: "what", width: 60 },
  ],
};

const multicaSquadSchema: OutputSchema<MulticaSquadRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 14 },
    { header: "NAME", field: "name", width: 24 },
    { header: "LEADER", field: "leader", width: 10 },
    { header: "DESCRIPTION", field: "description", width: 40 },
  ],
};

const multicaSquadMemberSchema: OutputSchema<MulticaSquadMemberRow> = {
  idField: "member",
  columns: [
    { header: "MEMBER", field: "member", width: 10 },
    { header: "TYPE", field: "type", width: 8 },
    { header: "ROLE", field: "role", width: 12 },
    { header: "LEADER", field: "leader", width: 8 },
  ],
};

function assigneePatchFromOptions(options: {
  clearAssignee?: boolean;
  assigneeId?: string;
  assigneeType?: string;
}): { assigneeType: string | null; assigneeId: string | null } | Record<string, never> {
  if (options.clearAssignee) {
    return { assigneeType: null, assigneeId: null };
  }
  if (options.assigneeId) {
    return { assigneeType: options.assigneeType ?? "agent", assigneeId: options.assigneeId };
  }
  return {};
}

/**
 * The source's mention grammar is markdown markup carrying the target's id;
 * a bare @name truncates on spaces. The CLI resolves names to ids here so
 * multi-word agent names wake whole.
 */
async function mentionMarkupFor(
  mention: string | string[] | undefined,
  host: string | undefined,
): Promise<string> {
  if (mention === undefined) {
    return "";
  }
  const names = Array.isArray(mention) ? mention : [mention];
  if (names.length === 0) {
    return "";
  }
  const client = await connectToDaemon({ host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host, error });
  });
  try {
    const [agents, squads] = await Promise.all([
      client.multicaAgentList({ includeSystem: true }),
      client.multicaSquadList(),
    ]);
    const parts: string[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (trimmed === "all") {
        parts.push("[@all](mention://all/all)");
        continue;
      }
      const agent = agents.agents.find((entry) => entry.name === trimmed);
      if (agent) {
        parts.push(`[@${agent.name}](mention://agent/${agent.id})`);
        continue;
      }
      const squad = squads.squads.find((entry) => entry.name === trimmed);
      if (squad) {
        parts.push(`[@${squad.name}](mention://squad/${squad.id})`);
        continue;
      }
      throw {
        code: "UNKNOWN_MENTION",
        message: `no agent or squad named ${trimmed}`,
      } satisfies CommandError;
    }
    return parts.join(" ");
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * The owner's inbox is owner-only on the daemon; a run session carrying its
 * id is refused there. Passing the id is what makes the refusal mechanical
 * rather than a convention agents must remember.
 */
function ownerCaller(): { senderSessionId?: string } {
  const senderSessionId = process.env.BYSPACE_AGENT_ID?.trim() || undefined;
  return senderSessionId ? { senderSessionId } : {};
}

export async function runMulticaLabelLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<MulticaLabelRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaLabelList();
    return {
      type: "list",
      data: payload.labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      schema: multicaLabelSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaLabelCreateCommand(
  options: CommandOptions & { name?: string; color?: string },
  _command: Command,
): Promise<ListResult<MulticaLabelRow>> {
  const name = options.name?.trim();
  if (!name) {
    throw { code: "MISSING_NAME", message: "--name is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaLabelCreate({
      name,
      color: options.color?.trim() || "#888888",
    });
    return {
      type: "list",
      data: [
        {
          id: payload.label.id.slice(0, 8),
          name: payload.label.name,
          color: payload.label.color,
        },
      ],
      schema: multicaLabelSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaLabelUpdateCommand(
  options: CommandOptions & { id?: string; name?: string; color?: string },
  _command: Command,
): Promise<ListResult<MulticaLabelRow>> {
  const id = options.id?.trim();
  if (!id) {
    throw { code: "MISSING_ID", message: "--id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaLabelUpdate({
      labelId: id,
      ...(options.name ? { name: options.name.trim() } : {}),
      ...(options.color ? { color: options.color.trim() } : {}),
    });
    return {
      type: "list",
      data: [
        {
          id: payload.label.id.slice(0, 8),
          name: payload.label.name,
          color: payload.label.color,
        },
      ],
      schema: multicaLabelSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runMulticaLabelDeleteCommand(
  options: CommandOptions & { id?: string },
  _command: Command,
): Promise<ListResult<MulticaLabelRow>> {
  const id = options.id?.trim();
  if (!id) {
    throw { code: "MISSING_ID", message: "--id is required" } satisfies CommandError;
  }
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
  try {
    const payload = await client.multicaLabelDelete({ labelId: id });
    return {
      type: "list",
      data: [{ id: id.slice(0, 8), name: payload.deleted ? "deleted" : "kept", color: "-" }],
      schema: multicaLabelSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
