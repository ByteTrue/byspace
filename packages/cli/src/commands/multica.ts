/**
 * The multica CLI: the operator's terminal surface for the replica.
 *
 * Mirrors the reference product's command surface in shape (issue / agent /
 * squad / comment) with one BySpace-specific addition: `office` opens the
 * secretary's channel — comment there and the chief of staff routes.
 */
import { Command } from "commander";
import {
  withOutput,
  type CommandError,
  type CommandOptions,
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
): Promise<{ type: "list"; data: MulticaIssueRow[]; schema: OutputSchema<MulticaIssueRow> }> {
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
): Promise<{ type: "list"; data: MulticaIssueRow[]; schema: OutputSchema<MulticaIssueRow> }> {
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
): Promise<{ type: "list"; data: MulticaAgentRow[]; schema: OutputSchema<MulticaAgentRow> }> {
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
): Promise<{ type: "list"; data: MulticaCommentRow[]; schema: OutputSchema<MulticaCommentRow> }> {
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
): Promise<{ type: "list"; data: MulticaCommentRow[]; schema: OutputSchema<MulticaCommentRow> }> {
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
    const payload = await client.multicaCommentCreate({ issueId, content: body });
    return {
      type: "list",
      data: [
        {
          author: "you",
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
): Promise<{ type: "list"; data: MulticaAgentRow[]; schema: OutputSchema<MulticaAgentRow> }> {
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
