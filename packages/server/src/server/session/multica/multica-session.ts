/**
 * The multica replica's session handler: RPC requests over the store.
 *
 * Thin by design — the handler translates wire payloads into store calls and
 * rows into wire summaries, and holds no domain rules; where the source's
 * handler layer does carry behavior (validation beyond shape, notification
 * emission), those land with their engine slices, not here.
 */
import type { SessionInboundMessage, SessionOutboundMessage } from "@bytetrue/protocol/messages";
import type { MulticaStore } from "../../multica/store.js";
import type {
  AgentRow,
  CommentRow,
  IssueRow,
  SquadMemberRow,
  SquadRow,
  TaskRow,
} from "../../multica/rows.js";
import type {
  MulticaAgentSummary,
  MulticaCommentSummary,
  MulticaIssueSummary,
  MulticaSquadMemberSummary,
  MulticaSquadSummary,
  MulticaTaskSummary,
} from "@bytetrue/protocol/multica/rpc-schemas";

export interface MulticaSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

function agentSummary(agent: AgentRow): MulticaAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    avatarUrl: agent.avatarUrl,
    status: agent.status,
    description: agent.description,
    instructions: agent.instructions,
    kind: agent.kind,
    systemKey: agent.systemKey,
    permissionMode: agent.permissionMode,
    maxConcurrentTasks: agent.maxConcurrentTasks,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    archivedAt: agent.archivedAt,
  };
}

function issueSummary(issue: IssueRow): MulticaIssueSummary {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    assigneeType: issue.assigneeType,
    assigneeId: issue.assigneeId,
    creatorType: issue.creatorType,
    creatorId: issue.creatorId,
    number: issue.number,
    projectId: issue.projectId,
    revision: issue.revision,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    lastActivityAt: issue.lastActivityAt,
  };
}

function commentSummary(comment: CommentRow): MulticaCommentSummary {
  return {
    id: comment.id,
    issueId: comment.issueId,
    authorType: comment.authorType,
    authorId: comment.authorId,
    content: comment.content,
    type: comment.type,
    parentId: comment.parentId,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    revision: comment.revision,
    sourceTaskId: comment.sourceTaskId,
  };
}

function squadSummary(squad: SquadRow): MulticaSquadSummary {
  return {
    id: squad.id,
    name: squad.name,
    description: squad.description,
    leaderId: squad.leaderId,
    instructions: squad.instructions,
    createdAt: squad.createdAt,
    updatedAt: squad.updatedAt,
  };
}

function memberSummary(member: SquadMemberRow): MulticaSquadMemberSummary {
  return {
    id: member.id,
    squadId: member.squadId,
    memberType: member.memberType,
    memberId: member.memberId,
    role: member.role,
  };
}

function taskSummary(task: TaskRow): MulticaTaskSummary {
  return {
    id: task.id,
    agentId: task.agentId,
    issueId: task.issueId,
    status: task.status,
    isLeaderTask: task.isLeaderTask,
    squadId: task.squadId,
    triggerCommentId: task.triggerCommentId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    error: task.error,
  };
}

export class MulticaSession {
  readonly #store: MulticaStore;
  readonly #host: MulticaSessionHost;

  constructor(input: { store: MulticaStore; host: MulticaSessionHost }) {
    this.#store = input.store;
    this.#host = input.host;
  }

  /**
   * The message the dispatcher routes here. The full inbound union is the
   * wire type; this handler's contract is the multica subset, and the
   * dispatcher's switch is what guarantees it.
   */
  async handle(msg: Extract<SessionInboundMessage, { type: `multica.${string}` }>): Promise<void> {
    try {
      switch (msg.type) {
        case "multica.agent.list.request":
          return this.#handleAgentList(msg);
        case "multica.agent.create.request":
          return this.#handleAgentCreate(msg);
        case "multica.issue.list.request":
          return this.#handleIssueList(msg);
        case "multica.issue.create.request":
          return this.#handleIssueCreate(msg);
        case "multica.issue.get.request":
          return this.#handleIssueGet(msg);
        case "multica.issue.status.update.request":
          return this.#handleIssueStatusUpdate(msg);
        case "multica.comment.list.request":
          return this.#handleCommentList(msg);
        case "multica.comment.create.request":
          return this.#handleCommentCreate(msg);
        case "multica.squad.list.request":
          return this.#handleSquadList(msg);
        case "multica.squad.create.request":
          return this.#handleSquadCreate(msg);
        case "multica.task.list.request":
          return this.#handleTaskList(msg);
        default:
          // The shared dispatcher routes only multica.* here; anything else
          // is a dispatcher bug worth surfacing, not silently swallowing.
          const unexpected: { requestId: string } = msg satisfies never;
          void unexpected;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: message,
          code: "handler_error",
        },
      });
    }
  }

  #emit(response: SessionOutboundMessage): void {
    this.#host.emit(response);
  }

  #handleAgentList(
    msg: Extract<SessionInboundMessage, { type: "multica.agent.list.request" }>,
  ): void {
    const agents = this.#store.listAgents({ includeArchived: msg.includeArchived });
    this.#emit({
      type: "multica.agent.list.response",
      payload: { requestId: msg.requestId, agents: agents.map(agentSummary) },
    });
  }

  #handleAgentCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.agent.create.request" }>,
  ): void {
    // The single local user is the creator of every agent in this form
    // factor; the wire carries no creator because there is only one.
    const agent = this.#store.createAgent({
      name: msg.name,
      description: msg.description,
      instructions: msg.instructions,
    });
    this.#emit({
      type: "multica.agent.create.response",
      payload: { requestId: msg.requestId, agent: agentSummary(agent) },
    });
  }

  #handleIssueList(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.list.request" }>,
  ): void {
    const issues = this.#store.listIssues({
      status: msg.status,
      assigneeId: msg.assigneeId,
      projectId: msg.projectId,
    });
    this.#emit({
      type: "multica.issue.list.response",
      payload: { requestId: msg.requestId, issues: issues.map(issueSummary) },
    });
  }

  #handleIssueCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.create.request" }>,
  ): void {
    const issue = this.#store.createIssue({
      title: msg.title,
      description: msg.description,
      status: msg.status,
      priority: msg.priority,
      assigneeType: msg.assigneeType,
      assigneeId: msg.assigneeId,
      projectId: msg.projectId,
      creatorType: "owner",
      creatorId: "owner",
    });
    this.#emit({
      type: "multica.issue.create.response",
      payload: { requestId: msg.requestId, issue: issueSummary(issue) },
    });
  }

  #handleIssueGet(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.get.request" }>,
  ): void {
    const issue = this.#store.getIssue(msg.issueId);
    this.#emit({
      type: "multica.issue.get.response",
      payload: { requestId: msg.requestId, issue: issueSummary(issue) },
    });
  }

  #handleIssueStatusUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.status.update.request" }>,
  ): void {
    const issue = this.#store.updateIssueStatus({
      id: msg.issueId,
      status: msg.status,
      expectedRevision: msg.expectedRevision,
    });
    this.#emit({
      type: "multica.issue.status.update.response",
      payload: { requestId: msg.requestId, issue: issueSummary(issue) },
    });
  }

  #handleCommentList(
    msg: Extract<SessionInboundMessage, { type: "multica.comment.list.request" }>,
  ): void {
    const comments = this.#store.listCommentsForIssue(msg.issueId);
    this.#emit({
      type: "multica.comment.list.response",
      payload: { requestId: msg.requestId, comments: comments.map(commentSummary) },
    });
  }

  #handleCommentCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.comment.create.request" }>,
  ): void {
    const comment = this.#store.createComment({
      issueId: msg.issueId,
      authorType: "owner",
      authorId: "owner",
      content: msg.content,
      parentId: msg.parentId,
    });
    this.#emit({
      type: "multica.comment.create.response",
      payload: { requestId: msg.requestId, comment: commentSummary(comment) },
    });
  }

  #handleSquadList(
    msg: Extract<SessionInboundMessage, { type: "multica.squad.list.request" }>,
  ): void {
    const squads = this.#store.listSquads();
    this.#emit({
      type: "multica.squad.list.response",
      payload: { requestId: msg.requestId, squads: squads.map(squadSummary) },
    });
  }

  #handleSquadCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.squad.create.request" }>,
  ): void {
    const squad = this.#store.createSquad({
      name: msg.name,
      description: msg.description,
      leaderId: msg.leaderId,
      creatorType: "owner",
      creatorId: "owner",
    });
    const members = (msg.members ?? []).map((member) =>
      this.#store.addSquadMember({
        squadId: squad.id,
        memberType: member.memberType,
        memberId: member.memberId,
      }),
    );
    this.#emit({
      type: "multica.squad.create.response",
      payload: {
        requestId: msg.requestId,
        squad: squadSummary(squad),
        members: members.map(memberSummary),
      },
    });
  }

  #handleTaskList(
    msg: Extract<SessionInboundMessage, { type: "multica.task.list.request" }>,
  ): void {
    const tasks = this.#store.listTasksForIssue(msg.issueId);
    this.#emit({
      type: "multica.task.list.response",
      payload: { requestId: msg.requestId, tasks: tasks.map(taskSummary) },
    });
  }
}
