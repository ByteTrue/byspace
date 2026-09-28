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
  InboxRow,
  TaskRow,
} from "../../multica/rows.js";
import type { WakeupRow } from "../../multica/wakeup.js";
import type {
  MulticaAgentSummary,
  MulticaCommentSummary,
  MulticaIssueSummary,
  MulticaSquadMemberSummary,
  MulticaSquadSummary,
  MulticaTaskSummary,
  MulticaInboxItemSummary,
  MulticaWakeupSummary,
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

function inboxSummary(item: InboxRow): MulticaInboxItemSummary {
  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    issueId: item.issueId,
    title: item.title,
    body: item.body,
    read: item.read,
    archived: item.archived,
    createdAt: item.createdAt,
    actorType: item.actorType,
    actorId: item.actorId,
  };
}

function wakeupSummary(wakeup: WakeupRow): MulticaWakeupSummary {
  return {
    id: wakeup.id,
    issueId: wakeup.issueId,
    agentId: wakeup.agentId,
    instruction: wakeup.instruction,
    kind: wakeup.kind,
    mode: wakeup.mode,
    eventTypes: [...wakeup.eventTypes],
    nextFireAt: wakeup.nextFireAt,
    enabled: wakeup.enabled,
    revision: wakeup.revision,
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

type MulticaInboundSubset = Extract<SessionInboundMessage, { type: `multica.${string}` }> & {
  requestId: string;
};

type WakeupOrInboxMessage = Extract<
  SessionInboundMessage,
  { type: `multica.inbox.${string}` | `multica.wakeup.${string}` }
> & { requestId: string };

/**
 * The two newest families route by prefix so the top-level switch stays
 * under the complexity ceiling; the predicate keeps both sides of the
 * narrowing exact, so exhaustiveness still fails closed.
 */
function isWakeupOrInboxMessage(msg: MulticaInboundSubset): msg is WakeupOrInboxMessage {
  return msg.type.startsWith("multica.inbox.") || msg.type.startsWith("multica.wakeup.");
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
  async handle(msg: MulticaInboundSubset): Promise<void> {
    try {
      if (isWakeupOrInboxMessage(msg)) {
        return await this.#handleWakeupAndInbox(msg);
      }
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

  /**
   * Who is speaking. A session id that resolves to a run is that run's
   * agent; a session id that resolves to nothing is refused (an agent speaks
   * on an issue only through a run, so a stray id is a lie, not a human);
   * no session id at all is the owner — the console and any human surface
   * send nothing.
   */
  #resolveCommentAuthor(senderSessionId: string | undefined): {
    type: "owner" | "agent";
    id: string;
  } {
    if (senderSessionId === undefined) {
      return { type: "owner", id: "owner" };
    }
    const task = this.#store.getTaskBySession(senderSessionId);
    if (!task) {
      throw new Error(`Session ${senderSessionId} is not a multica run`);
    }
    return { type: "agent", id: task.agentId };
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
    const author = this.#resolveCommentAuthor(msg.senderSessionId);
    const comment = this.#store.createComment({
      issueId: msg.issueId,
      authorType: author.type,
      authorId: author.id,
      content: msg.content,
      parentId: msg.parentId,
    });
    // The comment trigger: explicit mentions wake who they name; a human
    // comment on an assigned issue routes to the assignee. An agent's own
    // comment never re-triggers itself.
    const triggers = commentTriggers({
      store: this.#store,
      issue,
      content: msg.content,
      authorType: author.type,
      authorId: author.id,
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

  /**
   * The wakeup and inbox families each carry their own switch so the top
   * dispatcher stays under the complexity ceiling; the two groups arrived
   * together and share no state.
   */
  async #handleWakeupAndInbox(msg: WakeupOrInboxMessage): Promise<void> {
    switch (msg.type) {
      case "multica.inbox.list.request":
        return this.#handleInboxList(msg);
      case "multica.inbox.create.request":
        return this.#handleInboxCreate(msg);
      case "multica.inbox.mark.request":
        return this.#handleInboxMark(msg);
      case "multica.inbox.archive.request":
        return this.#handleInboxArchive(msg);
      case "multica.inbox.mark_all.request":
        return this.#handleInboxMarkAll(msg);
      case "multica.wakeup.list.request":
        return this.#handleWakeupList(msg);
      case "multica.wakeup.create.request":
        return this.#handleWakeupCreate(msg);
      case "multica.wakeup.disable.request":
        return this.#handleWakeupDisable(msg);
      default:
        msg satisfies never;
    }
  }

  #handleInboxList(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.list.request" }>,
  ): void {
    this.#emit({
      type: "multica.inbox.list.response",
      payload: {
        requestId: msg.requestId,
        items: this.#store.listInbox({ archived: msg.archived ?? false }).map(inboxSummary),
        unread: this.#store.countUnreadInbox(),
      },
    });
  }

  #handleInboxCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.create.request" }>,
  ): void {
    // Only a run may put something on the owner's desk: resolve like a
    // comment author, and refuse what does not resolve.
    const task = this.#store.getTaskBySession(msg.senderSessionId);
    if (!task) {
      throw new Error(`Session ${msg.senderSessionId} is not a multica run`);
    }
    const item = this.#store.createInboxItem({
      type: "agent.escalation",
      severity: msg.severity,
      issueId: msg.issueId ?? null,
      title: msg.title,
      body: msg.body ?? null,
      actorType: "agent",
      actorId: task.agentId,
      details: { task_id: task.id },
    });
    this.#emit({
      type: "multica.inbox.create.response",
      payload: { requestId: msg.requestId, item: inboxSummary(item) },
    });
  }

  #handleInboxMark(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.mark.request" }>,
  ): void {
    const item = this.#store.markInboxRead(msg.id, msg.read);
    this.#emit({
      type: "multica.inbox.mark.response",
      payload: { requestId: msg.requestId, item: inboxSummary(item) },
    });
  }

  #handleInboxArchive(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.archive.request" }>,
  ): void {
    const item = this.#store.archiveInboxItem(msg.id, msg.archived);
    this.#emit({
      type: "multica.inbox.archive.response",
      payload: { requestId: msg.requestId, item: inboxSummary(item) },
    });
  }

  #handleInboxMarkAll(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.mark_all.request" }>,
  ): void {
    const changed = this.#store.markAllInboxRead();
    this.#emit({
      type: "multica.inbox.mark_all.response",
      payload: { requestId: msg.requestId, changed },
    });
  }

  #handleWakeupList(
    msg: Extract<SessionInboundMessage, { type: "multica.wakeup.list.request" }>,
  ): void {
    this.#emit({
      type: "multica.wakeup.list.response",
      payload: {
        requestId: msg.requestId,
        wakeups: this.#store.listWakeupsForIssue(msg.issueId).map(wakeupSummary),
      },
    });
  }

  #handleWakeupCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.wakeup.create.request" }>,
  ): void {
    // A registering agent is resolved from its session exactly like a
    // comment author: the subscription belongs to the run that asked for
    // it, and the self-trigger guard reads that source task back.
    let sourceTaskId: string | null = null;
    if (msg.senderSessionId !== undefined) {
      const task = this.#store.getTaskBySession(msg.senderSessionId);
      if (!task) {
        throw new Error(`Session ${msg.senderSessionId} is not a multica run`);
      }
      sourceTaskId = task.id;
    }
    const wakeup = this.#store.createWakeup({
      issueId: msg.issueId,
      agentId: msg.agentId,
      createdBy: msg.senderSessionId !== undefined ? msg.agentId : "owner",
      instruction: msg.instruction,
      kind: msg.kind,
      mode: msg.mode,
      eventTypes: msg.eventTypes,
      intervalSeconds: msg.intervalSeconds ?? null,
      cronExpression: msg.cronExpression ?? null,
      timezone: msg.timezone,
      at: msg.at ?? null,
      sourceTaskId,
    });
    this.#emit({
      type: "multica.wakeup.create.response",
      payload: { requestId: msg.requestId, wakeup: wakeupSummary(wakeup) },
    });
  }

  #handleWakeupDisable(
    msg: Extract<SessionInboundMessage, { type: "multica.wakeup.disable.request" }>,
  ): void {
    const wakeup = this.#store.disableWakeup(msg.id);
    this.#emit({
      type: "multica.wakeup.disable.response",
      payload: { requestId: msg.requestId, wakeup: wakeupSummary(wakeup) },
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
