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
import {
  commentTriggers,
  hasPendingRun,
  parseMentions,
  willEnqueueRun,
} from "../../multica/trigger-engine.js";
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
  readonly #onEnqueued: (() => void) | null;

  constructor(input: {
    store: MulticaStore;
    host: MulticaSessionHost;
    /** Notifies the executor that a run may be ready (kick a drain). */
    onEnqueued?: () => void;
  }) {
    this.#store = input.store;
    this.#host = input.host;
    this.#onEnqueued = input.onEnqueued ?? null;
  }

  /**
   * The message the dispatcher routes here. The full inbound union is the
   * wire type; this handler's contract is the multica subset, and the
   * dispatcher's switch is what guarantees it.
   */
  async handle(
    msg: Extract<SessionInboundMessage, { type: `multica.${string}` }> & { requestId: string },
  ): Promise<void> {
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
        case "multica.status.list.request":
          return this.#handleStatusList(msg);
        case "multica.issue.update.request":
          return this.#handleIssueUpdate(msg);
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
        case "multica.task.running.list.request":
          return this.#handleTaskRunningList(msg);
        case "multica.task.list.request":
          return this.#handleTaskList(msg);
        default:
          // The switch is exhaustive over the multica subset; the dispatcher's
          // prefix check is what routes here, so this arm is unreachable.
          msg satisfies never;
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
    const agents = this.#store.listAgents({
      includeArchived: msg.includeArchived ?? false,
      includeSystem: msg.includeSystem ?? false,
    });
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
    this.#enqueueForIssueWrite(issue, {
      isCreate: true,
      assigneeChanged: false,
      statusChanged: false,
      prevStatus: "backlog",
    });
    this.#emit({
      type: "multica.issue.create.response",
      payload: { requestId: msg.requestId, issue: issueSummary(issue) },
    });
  }

  /**
   * The issue-write trigger: when a write starts a run, enqueue it and kick
   * the executor. The predicate is the engine's single source of truth.
   */
  #enqueueForIssueWrite(
    issue: ReturnType<MulticaStore["getIssue"]>,
    write: {
      isCreate: boolean;
      assigneeChanged: boolean;
      statusChanged: boolean;
      prevStatus: string;
    },
  ): void {
    const decision = willEnqueueRun({ store: this.#store, issue, ...write });
    if (!decision) {
      return;
    }
    if (hasPendingRun(this.#store, issue.id, decision.agentId)) {
      return;
    }
    this.#store.createTask({
      agentId: decision.agentId,
      issueId: issue.id,
      triggerSummary: `${decision.source} → ${decision.assigneeType}`,
    });
    this.#onEnqueued?.();
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

  #handleStatusList(
    msg: Extract<SessionInboundMessage, { type: "multica.status.list.request" }>,
  ): void {
    const statuses = this.#store.listIssueStatuses();
    this.#emit({
      type: "multica.status.list.response",
      payload: { requestId: msg.requestId, statuses },
    });
  }

  #handleIssueUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.update.request" }>,
  ): void {
    const before = this.#store.getIssue(msg.issueId);
    const issue = this.#store.updateIssue({
      id: msg.issueId,
      expectedRevision: msg.expectedRevision,
      status: msg.status,
      priority: msg.priority,
      assigneeType: msg.assigneeType,
      assigneeId: msg.assigneeId,
      title: msg.title,
    });
    // Field writes that the trigger engine cares about: a reassignment or a
    // backlog departure can start a run, exactly as a create does.
    const assigneeChanged =
      (msg.assigneeType !== undefined && msg.assigneeType !== before.assigneeType) ||
      (msg.assigneeId !== undefined && msg.assigneeId !== before.assigneeId);
    const statusChanged = msg.status !== undefined && msg.status !== before.status;
    if (assigneeChanged || statusChanged) {
      this.#enqueueForIssueWrite(issue, {
        isCreate: false,
        assigneeChanged,
        statusChanged,
        prevStatus: before.status,
      });
    }
    this.#emit({
      type: "multica.issue.update.response",
      payload: { requestId: msg.requestId, issue: issueSummary(issue) },
    });
  }

  #handleIssueStatusUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.status.update.request" }>,
  ): void {
    const before = this.#store.getIssue(msg.issueId);
    const issue = this.#store.updateIssueStatus({
      id: msg.issueId,
      status: msg.status,
      expectedRevision: msg.expectedRevision,
    });
    this.#enqueueForIssueWrite(issue, {
      isCreate: false,
      assigneeChanged: false,
      statusChanged: true,
      prevStatus: before.status,
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
    const issue = this.#store.getIssue(msg.issueId);
    const comment = this.#store.createComment({
      issueId: msg.issueId,
      authorType: "owner",
      authorId: "owner",
      content: msg.content,
      parentId: msg.parentId,
    });
    // The comment trigger: explicit mentions wake who they name; a human
    // comment on an assigned issue routes to the assignee.
    const triggers = commentTriggers({
      store: this.#store,
      issue,
      content: msg.content,
      authorType: "owner",
      authorId: "owner",
      mentions: parseMentions(msg.content),
    });
    for (const trigger of triggers) {
      if (hasPendingRun(this.#store, msg.issueId, trigger.agentId)) {
        continue;
      }
      this.#store.createTask({
        agentId: trigger.agentId,
        issueId: msg.issueId,
        triggerCommentId: comment.id,
        triggerSummary: `comment ${trigger.reason}`,
      });
      this.#onEnqueued?.();
    }
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

  #handleTaskRunningList(
    msg: Extract<SessionInboundMessage, { type: "multica.task.running.list.request" }>,
  ): void {
    this.#emit({
      type: "multica.task.running.list.response",
      payload: { requestId: msg.requestId, tasks: this.#store.listRunningTasks().map(taskSummary) },
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
