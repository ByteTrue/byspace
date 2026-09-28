/**
 * The multica replica's session handler: RPC requests over the store.
 *
 * Thin by design — the handler translates wire payloads into store calls and
 * rows into wire summaries, and holds no domain rules; where the source's
 * handler layer does carry behavior (validation beyond shape, notification
 * emission), those land with their engine slices, not here.
 */
import type { SessionInboundMessage, SessionOutboundMessage } from "@bytetrue/protocol/messages";
import { dispatchAutopilot } from "../../multica/autopilot.js";
import { computeNextRunAt } from "../../schedule/cron.js";
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
  AutopilotRow,
  AutopilotRunRow,
  InboxRow,
  LabelRow,
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
  MulticaAgentDetail,
  MulticaAutopilotRunSummary,
  MulticaAutopilotSummary,
  MulticaSquadDetail,
  MulticaInboxItemSummary,
  MulticaLabelSummary,
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
    model: agent.model,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    archivedAt: agent.archivedAt,
  };
}

function labelSummary(label: LabelRow): MulticaLabelSummary {
  return { id: label.id, name: label.name, color: label.color };
}

function issueSummary(store: MulticaStore, issue: IssueRow): MulticaIssueSummary {
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
    position: issue.position,
    labels: store.listLabelsForIssue(issue.id).map(labelSummary),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    lastActivityAt: issue.lastActivityAt,
  };
}

function commentSummary(
  comment: CommentRow,
  reactions: MulticaCommentSummary["reactions"] = [],
): MulticaCommentSummary {
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
    deletedAt: comment.deletedAt,
    resolvedAt: comment.resolvedAt,
    reactions,
  };
}

function agentDetail(agent: AgentRow): MulticaAgentDetail {
  return {
    id: agent.id,
    name: agent.name,
    kind: agent.kind,
    systemKey: agent.systemKey,
    status: agent.status,
    description: agent.description,
    instructions: agent.instructions,
    model: agent.model,
    permissionMode: agent.permissionMode,
    maxConcurrentTasks: agent.maxConcurrentTasks,
    thinkingLevel: agent.thinkingLevel,
    archivedAt: agent.archivedAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function squadDetail(store: MulticaStore, squadId: string): MulticaSquadDetail {
  const squad = store.getSquad(squadId);
  return {
    id: squad.id,
    name: squad.name,
    description: squad.description,
    leaderId: squad.leaderId,
    instructions: squad.instructions,
    members: store.listSquadMembers(squadId).map((member) => ({
      memberType: member.memberType,
      memberId: member.memberId,
      role: member.role,
    })),
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

function autopilotSummary(store: MulticaStore, autopilot: AutopilotRow): MulticaAutopilotSummary {
  return {
    id: autopilot.id,
    title: autopilot.title,
    description: autopilot.description,
    assigneeType: autopilot.assigneeType,
    assigneeId: autopilot.assigneeId,
    status: autopilot.status,
    executionMode: autopilot.executionMode,
    issueTitleTemplate: autopilot.issueTitleTemplate,
    concurrencyPolicy: autopilot.concurrencyPolicy,
    lastRunAt: autopilot.lastRunAt,
    triggers: store.listAutopilotTriggers(autopilot.id).map((trigger) => ({
      id: trigger.id,
      kind: trigger.kind,
      enabled: trigger.enabled,
      cronExpression: trigger.cronExpression,
      timezone: trigger.timezone,
      nextRunAt: trigger.nextRunAt,
      label: trigger.label,
    })),
  };
}

function runSummary(run: AutopilotRunRow): MulticaAutopilotRunSummary {
  return {
    id: run.id,
    autopilotId: run.autopilotId,
    source: run.source,
    status: run.status,
    issueId: run.issueId,
    taskId: run.taskId,
    triggeredAt: run.triggeredAt,
    failureReason: run.failureReason,
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

function workspaceWakeupSummary(
  wakeup: WakeupRow,
  issueTitle: string | null,
): MulticaWakeupSummary & { issueTitle: string | null } {
  const base = wakeupSummary(wakeup);
  return {
    id: base.id,
    issueId: base.issueId,
    agentId: base.agentId,
    instruction: base.instruction,
    kind: base.kind,
    mode: base.mode,
    eventTypes: base.eventTypes,
    nextFireAt: base.nextFireAt,
    enabled: base.enabled,
    revision: base.revision,
    issueTitle,
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
  {
    type: `multica.inbox.${string}` | `multica.wakeup.${string}` | `multica.autopilot.${string}`;
  }
> & { requestId: string };

/**
 * The two newest families route by prefix so the top-level switch stays
 * under the complexity ceiling; the predicate keeps both sides of the
 * narrowing exact, so exhaustiveness still fails closed.
 */
type ReadMessage = Extract<
  SessionInboundMessage,
  {
    type:
      | "multica.agent.list.request"
      | "multica.issue.list.request"
      | "multica.issue.get.request"
      | "multica.status.list.request"
      | "multica.task.running.list.request"
      | "multica.task.list.request"
      | "multica.timeline.list.request"
      | "multica.subscriber.list.request"
      | "multica.subscriber.set.request"
      | "multica.label.list.request"
      | "multica.issue.mine.request";
  }
>;

type CreateMessage = Extract<
  SessionInboundMessage,
  {
    type:
      | "multica.agent.create.request"
      | "multica.issue.create.request"
      | "multica.squad.create.request";
  }
>;

type WriteMessage = Extract<
  SessionInboundMessage,
  {
    type:
      | "multica.issue.update.request"
      | "multica.issue.status.update.request"
      | "multica.comment.create.request"
      | "multica.agent.status.request"
      | "multica.squad.add_member.request"
      | "multica.squad.remove_member.request"
      | "multica.reaction.set.request"
      | "multica.label.create.request"
      | "multica.issue.labels.set.request"
      | "multica.comment.update.request"
      | "multica.comment.delete.request"
      | "multica.label.update.request"
      | "multica.label.delete.request"
      | "multica.agent.update.request"
      | "multica.squad.update.request"
      | "multica.squad.member_role.request"
      | "multica.comment.resolve.request";
  }
>;

type RosterOrConversationMessage = Extract<
  SessionInboundMessage,
  {
    type:
      | "multica.agent.get.request"
      | "multica.squad.get.request"
      | "multica.squad.list.request"
      | "multica.comment.list.request";
  }
>;

const TIMELINE_CAP = 200;

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isReadMessage(msg: MulticaInboundSubset): msg is ReadMessage {
  return (
    msg.type === "multica.agent.list.request" ||
    msg.type === "multica.issue.list.request" ||
    msg.type === "multica.issue.get.request" ||
    msg.type === "multica.status.list.request" ||
    msg.type === "multica.task.running.list.request" ||
    msg.type === "multica.task.list.request" ||
    msg.type === "multica.timeline.list.request" ||
    msg.type === "multica.subscriber.list.request" ||
    msg.type === "multica.subscriber.set.request" ||
    // The type predicate alone lies: without this runtime check a read
    // falls through to the write arm and is answered with silence.
    msg.type === "multica.label.list.request" ||
    msg.type === "multica.issue.mine.request"
  );
}

function isCreateMessage(msg: MulticaInboundSubset): msg is CreateMessage {
  return (
    msg.type === "multica.agent.create.request" ||
    msg.type === "multica.issue.create.request" ||
    msg.type === "multica.squad.create.request"
  );
}

function isRosterOrConversationMessage(
  msg: MulticaInboundSubset,
): msg is RosterOrConversationMessage {
  return (
    msg.type === "multica.agent.get.request" ||
    msg.type === "multica.squad.get.request" ||
    msg.type === "multica.squad.list.request" ||
    msg.type === "multica.comment.list.request"
  );
}

function isWakeupOrInboxMessage(msg: MulticaInboundSubset): msg is WakeupOrInboxMessage {
  return (
    msg.type.startsWith("multica.inbox.") ||
    msg.type.startsWith("multica.wakeup.") ||
    msg.type.startsWith("multica.autopilot.")
  );
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
      // Four arms by intent — reads, creates, writes, and the roster plus
      // conversation surface — each with its own exhaustive sub-switch, so
      // this entry point stays a directory, not a switchboard.
      if (isReadMessage(msg)) {
        return this.#handleReadMessage(msg);
      }
      if (isCreateMessage(msg)) {
        return this.#handleCreateMessage(msg);
      }
      if (isRosterOrConversationMessage(msg)) {
        return this.#handleRosterMessage(msg);
      }
      return this.#handleWriteMessage(msg);
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
      payload: {
        requestId: msg.requestId,
        issues: issues.map((issue) => issueSummary(this.#store, issue)),
      },
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

      parentIssueId: msg.parentIssueId,
    });
    this.#enqueueForIssueWrite(issue, {
      isCreate: true,
      assigneeChanged: false,
      statusChanged: false,
      prevStatus: "backlog",
    });
    this.#emit({
      type: "multica.issue.create.response",
      payload: { requestId: msg.requestId, issue: issueSummary(this.#store, issue) },
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
      payload: {
        requestId: msg.requestId,
        issue: issueSummary(this.#store, issue),
        children: this.#store
          .listChildIssues(issue.id)
          .map((child) => issueSummary(this.#store, child)),
      },
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
      position: msg.position ?? null,
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
      payload: { requestId: msg.requestId, issue: issueSummary(this.#store, issue) },
    });
  }

  #handleIssueStatusUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.status.update.request" }>,
  ): void {
    const before = this.#store.getIssue(msg.issueId);
    const author = this.#resolveCommentAuthor(msg.senderSessionId);
    const issue = this.#store.updateIssueStatus({
      id: msg.issueId,
      status: msg.status,
      expectedRevision: msg.expectedRevision,
      actorType: author.type,
      actorId: author.type === "owner" ? null : author.id,
    });
    this.#enqueueForIssueWrite(issue, {
      isCreate: false,
      assigneeChanged: false,
      statusChanged: true,
      prevStatus: before.status,
    });
    this.#emit({
      type: "multica.issue.status.update.response",
      payload: { requestId: msg.requestId, issue: issueSummary(this.#store, issue) },
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
      payload: {
        requestId: msg.requestId,
        comments: comments.map((comment) =>
          commentSummary(comment, this.#ownerReactions(comment.id)),
        ),
      },
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
      mentions: parseMentions(msg.content),
      agentIdByName: new Map(
        this.#store.listAgents({ includeSystem: true }).map((agent) => [agent.name, agent.id]),
      ),
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
      payload: {
        requestId: msg.requestId,
        comment: commentSummary(comment, this.#ownerReactions(comment.id)),
      },
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
    // The leader is already on the roster (createSquad adds it); a request
    // that names the leader again must not collide with that row.
    for (const member of msg.members ?? []) {
      if (member.memberId === msg.leaderId) {
        continue;
      }
      this.#store.addSquadMember({
        squadId: squad.id,
        memberType: member.memberType,
        memberId: member.memberId,
      });
    }
    // The response carries the roster as stored — including the leader the
    // create added — not the request's member list.
    this.#emit({
      type: "multica.squad.create.response",
      payload: {
        requestId: msg.requestId,
        squad: squadSummary(squad),
        members: this.#store.listSquadMembers(squad.id).map(memberSummary),
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
      case "multica.inbox.archive_all.request":
        return this.#handleInboxArchiveAll(msg);
      case "multica.wakeup.list.request":
        return this.#handleWakeupList(msg);
      case "multica.wakeup.create.request":
        return this.#handleWakeupCreate(msg);
      case "multica.wakeup.disable.request":
        return this.#handleWakeupDisable(msg);
      case "multica.wakeup.workspace_list.request":
        return this.#handleWakeupWorkspaceList(msg);
      case "multica.wakeup.enable.request":
        return this.#handleWakeupEnable(msg);
      case "multica.autopilot.list.request":
        return this.#handleAutopilotList(msg);
      case "multica.autopilot.create.request":
        return this.#handleAutopilotCreate(msg);
      case "multica.autopilot.trigger.request":
        return this.#handleAutopilotTrigger(msg);
      case "multica.autopilot.runs.request":
        return this.#handleAutopilotRuns(msg);
      case "multica.autopilot.status.request":
        return this.#handleAutopilotStatus(msg);
      default:
        msg satisfies never;
    }
  }

  #handleAutopilotList(
    msg: Extract<SessionInboundMessage, { type: "multica.autopilot.list.request" }>,
  ): void {
    this.#emit({
      type: "multica.autopilot.list.response",
      payload: {
        requestId: msg.requestId,
        autopilots: this.#store
          .listAutopilots()
          .map((autopilot) => autopilotSummary(this.#store, autopilot)),
      },
    });
  }

  #handleAutopilotCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.autopilot.create.request" }>,
  ): void {
    const autopilot = this.#store.createAutopilot({
      title: msg.title,
      description: msg.description ?? null,
      assigneeType: msg.assigneeType,
      assigneeId: msg.assigneeId,
      executionMode: msg.executionMode,
      issueTitleTemplate: msg.issueTitleTemplate ?? null,
      concurrencyPolicy: msg.concurrencyPolicy ?? "skip",
    });
    if (msg.cron !== undefined) {
      const nextRunAt = computeNextRunAt(
        { type: "cron", expression: msg.cron, timezone: msg.timezone ?? "UTC" },
        new Date(),
      ).toISOString();
      this.#store.createAutopilotTrigger({
        autopilotId: autopilot.id,
        kind: "schedule",
        cronExpression: msg.cron,
        timezone: msg.timezone ?? "UTC",
        nextRunAt,
      });
    }
    this.#emit({
      type: "multica.autopilot.create.response",
      payload: {
        requestId: msg.requestId,
        autopilot: autopilotSummary(this.#store, this.#store.getAutopilot(autopilot.id)),
      },
    });
  }

  #handleAutopilotTrigger(
    msg: Extract<SessionInboundMessage, { type: "multica.autopilot.trigger.request" }>,
  ): void {
    const autopilot = this.#store.getAutopilot(msg.id);
    const result = dispatchAutopilot({
      store: this.#store,
      autopilot,
      trigger: null,
      source: "manual",
      now: new Date(),
    });
    this.#onEnqueued?.();
    this.#emit({
      type: "multica.autopilot.trigger.response",
      payload: {
        requestId: msg.requestId,
        run: runSummary(result.run),
        fired: result.fired,
        reason: result.reason,
      },
    });
  }

  #handleAutopilotRuns(
    msg: Extract<SessionInboundMessage, { type: "multica.autopilot.runs.request" }>,
  ): void {
    this.#emit({
      type: "multica.autopilot.runs.response",
      payload: {
        requestId: msg.requestId,
        runs: this.#store.listAutopilotRuns(msg.id).map(runSummary),
      },
    });
  }

  #handleAutopilotStatus(
    msg: Extract<SessionInboundMessage, { type: "multica.autopilot.status.request" }>,
  ): void {
    const autopilot = this.#store.setAutopilotStatus({
      id: msg.id,
      status: msg.status,
      pauseReason: msg.pauseReason ?? null,
    });
    this.#emit({
      type: "multica.autopilot.status.response",
      payload: {
        requestId: msg.requestId,
        autopilot: autopilotSummary(this.#store, autopilot),
      },
    });
  }

  /**
   * The owner's queue has no agent face: a run session asking to read or
   * file it is refused, as the source's member-only inbox handlers are.
   * Creating an item is the one agent→owner direction and stays open.
   */
  #assertOwnerOnlyInbox(senderSessionId: string | undefined): void {
    if (senderSessionId === undefined) {
      return;
    }
    const task = this.#store.getTaskBySession(senderSessionId);
    if (task !== null) {
      throw new Error("the owner's inbox is not an agent surface");
    }
  }

  #handleInboxList(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.list.request" }>,
  ): void {
    this.#assertOwnerOnlyInbox(msg.senderSessionId);
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
    this.#assertOwnerOnlyInbox(msg.senderSessionId);
    const item = this.#store.markInboxRead(msg.id, msg.read);
    this.#emit({
      type: "multica.inbox.mark.response",
      payload: { requestId: msg.requestId, item: inboxSummary(item) },
    });
  }

  #handleInboxArchive(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.archive.request" }>,
  ): void {
    this.#assertOwnerOnlyInbox(msg.senderSessionId);
    const item = this.#store.archiveInboxItem(msg.id, msg.archived);
    this.#emit({
      type: "multica.inbox.archive.response",
      payload: { requestId: msg.requestId, item: inboxSummary(item) },
    });
  }

  /**
   * The two bulk archive verbs as one RPC with a flag: archive everything
   * live, or only what is already read — the source carries them as two
   * endpoints over the same store shape.
   */
  #handleInboxArchiveAll(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.archive_all.request" }>,
  ): void {
    this.#assertOwnerOnlyInbox(msg.senderSessionId);
    const changed =
      msg.readOnly === true ? this.#store.archiveAllReadInbox() : this.#store.archiveAllInbox();
    this.#emit({
      type: "multica.inbox.archive_all.response",
      payload: { requestId: msg.requestId, changed },
    });
  }

  #handleInboxMarkAll(
    msg: Extract<SessionInboundMessage, { type: "multica.inbox.mark_all.request" }>,
  ): void {
    this.#assertOwnerOnlyInbox(msg.senderSessionId);
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

  /** The registry the source's wakeups tab lists: every issue's
   * subscriptions across the workspace, with the issue's title for reading. */
  #handleWakeupWorkspaceList(
    msg: Extract<SessionInboundMessage, { type: "multica.wakeup.workspace_list.request" }>,
  ): void {
    this.#emit({
      type: "multica.wakeup.workspace_list.response",
      payload: {
        requestId: msg.requestId,
        wakeups: this.#store
          .listWorkspaceWakeups()
          .map((wakeup) => workspaceWakeupSummary(wakeup, this.#issueTitleFor(wakeup.issueId))),
      },
    });
  }

  #handleWakeupEnable(
    msg: Extract<SessionInboundMessage, { type: "multica.wakeup.enable.request" }>,
  ): void {
    this.#assertLiveOriginator(msg.senderSessionId);
    const wakeup = this.#store.enableWakeup(msg.id);
    this.#emit({
      type: "multica.wakeup.enable.response",
      payload: { requestId: msg.requestId, wakeup: wakeupSummary(wakeup) },
    });
  }

  #issueTitleFor(issueId: string): string | null {
    try {
      return this.#store.getIssue(issueId).title;
    } catch {
      return null;
    }
  }

  /**
   * The source's wakeup control writes need a human originator: a member, or
   * a run still in flight carrying one. A finished run's session resolves to
   * nobody — its words cannot retire or revive a subscription after the run
   * is over.
   */
  #assertLiveOriginator(senderSessionId: string | undefined): void {
    if (senderSessionId === undefined) {
      return;
    }
    const task = this.#store.getTaskBySession(senderSessionId);
    if (!task) {
      throw new Error(`Session ${senderSessionId} is not a multica run`);
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      throw new Error("a finished run cannot control wakeups");
    }
  }

  #handleWakeupDisable(
    msg: Extract<SessionInboundMessage, { type: "multica.wakeup.disable.request" }>,
  ): void {
    this.#assertLiveOriginator(msg.senderSessionId);
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

  /** The pure reads: rosters, boards, catalogs, queues. */
  #handleReadMessage(msg: ReadMessage): void {
    switch (msg.type) {
      case "multica.agent.list.request":
        return this.#handleAgentList(msg);
      case "multica.issue.list.request":
        return this.#handleIssueList(msg);
      case "multica.issue.get.request":
        return this.#handleIssueGet(msg);
      case "multica.status.list.request":
        return this.#handleStatusList(msg);
      case "multica.task.running.list.request":
        return this.#handleTaskRunningList(msg);
      case "multica.task.list.request":
        return this.#handleTaskList(msg);
      case "multica.timeline.list.request":
        return this.#handleTimelineList(msg);
      case "multica.issue.mine.request":
        return this.#handleIssueMine(msg);
      case "multica.label.list.request":
        return this.#handleLabelList(msg);
      case "multica.subscriber.list.request":
        return this.#handleSubscriberList(msg);
      case "multica.subscriber.set.request":
        return this.#handleSubscriberSet(msg);
      default:
        msg satisfies never;
    }
  }

  /**
   * The issue's record as one stream: activities and comments interleaved
   * by time, as the source's timeline merges them. Comments keep their full
   * shape; activities carry what changed.
   */
  #handleTimelineList(
    msg: Extract<SessionInboundMessage, { type: "multica.timeline.list.request" }>,
  ): void {
    const activities = this.#store.listActivitiesForIssue(msg.issueId);
    const comments = this.#store.listCommentsForIssue(msg.issueId);
    const entries = [
      ...activities.map((activity) => ({
        kind: "activity" as const,
        id: activity.id,
        createdAt: activity.createdAt,
        action: activity.action,
        actorType: activity.actorType,
        actorId: activity.actorId,
        details: parseJsonRecord(activity.details),
        content: null,
        authorType: null,
        authorId: null,
        parentId: null,
        reactions: null,
        deletedAt: null,
        resolvedAt: null,
      })),
      ...comments.map((comment) => ({
        kind: "comment" as const,
        id: comment.id,
        createdAt: comment.createdAt,
        action: null,
        actorType: null,
        actorId: null,
        details: null,
        content: comment.content,
        authorType: comment.authorType,
        authorId: comment.authorId,
        parentId: comment.parentId,
        reactions: this.#ownerReactions(comment.id),
        deletedAt: comment.deletedAt,
        resolvedAt: comment.resolvedAt,
      })),
    ]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, TIMELINE_CAP);
    this.#emit({
      type: "multica.timeline.list.response",
      payload: {
        requestId: msg.requestId,
        entries,
        truncated: activities.length + comments.length > TIMELINE_CAP,
      },
    });
  }

  /** The three create surfaces. */
  #handleCreateMessage(msg: CreateMessage): void {
    switch (msg.type) {
      case "multica.agent.create.request":
        return this.#handleAgentCreate(msg);
      case "multica.issue.create.request":
        return this.#handleIssueCreate(msg);
      case "multica.squad.create.request":
        return this.#handleSquadCreate(msg);
      default:
        msg satisfies never;
    }
  }

  /** The trigger-aware writes: issue fields, status, comments, roster membership. */
  #handleWriteMessage(msg: WriteMessage): void {
    switch (msg.type) {
      case "multica.issue.update.request":
        return this.#handleIssueUpdate(msg);
      case "multica.issue.status.update.request":
        return this.#handleIssueStatusUpdate(msg);
      case "multica.comment.create.request":
        return this.#handleCommentCreate(msg);
      case "multica.agent.status.request":
        return this.#handleAgentStatus(msg);
      case "multica.agent.update.request":
        return this.#handleAgentUpdate(msg);
      case "multica.squad.add_member.request":
        return this.#handleSquadAddMember(msg);
      case "multica.squad.remove_member.request":
        return this.#handleSquadRemoveMember(msg);
      case "multica.squad.update.request":
        return this.#handleSquadUpdate(msg);
      case "multica.squad.member_role.request":
        return this.#handleSquadMemberRole(msg);
      case "multica.reaction.set.request":
        return this.#handleReactionSet(msg);
      case "multica.comment.update.request":
        return this.#handleCommentUpdate(msg);
      case "multica.comment.delete.request":
        return this.#handleCommentDelete(msg);
      case "multica.comment.resolve.request":
        return this.#handleCommentResolve(msg);
      case "multica.label.create.request":
        return this.#handleLabelCreate(msg);
      case "multica.issue.labels.set.request":
        return this.#handleIssueLabelsSet(msg);
      case "multica.label.update.request":
        return this.#handleLabelUpdate(msg);
      case "multica.label.delete.request":
        return this.#handleLabelDelete(msg);
      default:
        msg satisfies never;
    }
  }

  /** The roster reads plus the conversation's read surface. */
  #handleSubscriberList(
    msg: Extract<SessionInboundMessage, { type: "multica.subscriber.list.request" }>,
  ): void {
    this.#emit({
      type: "multica.subscriber.list.response",
      payload: {
        requestId: msg.requestId,
        subscribers: this.#store.listActiveSubscribers(msg.issueId),
      },
    });
  }

  #handleSubscriberSet(
    msg: Extract<SessionInboundMessage, { type: "multica.subscriber.set.request" }>,
  ): void {
    const author = this.#resolveCommentAuthor(msg.senderSessionId);
    const userType = author.type === "agent" ? "agent" : "owner";
    const userId = author.type === "owner" ? "owner" : author.id;
    if (msg.subscribed) {
      this.#store.addSubscriber({
        issueId: msg.issueId,
        userType,
        userId,
        reason: "manual",
      });
    } else {
      this.#store.unsubscribe({ issueId: msg.issueId, userType, userId });
    }
    this.#emit({
      type: "multica.subscriber.set.response",
      payload: {
        requestId: msg.requestId,
        subscribers: this.#store.listActiveSubscribers(msg.issueId),
      },
    });
  }

  #handleIssueMine(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.mine.request" }>,
  ): void {
    this.#emit({
      type: "multica.issue.mine.response",
      payload: {
        requestId: msg.requestId,
        scope: msg.scope,
        issues: this.#store
          .listMyIssues(msg.scope)
          .map((issue) => issueSummary(this.#store, issue)),
      },
    });
  }

  #handleLabelList(
    msg: Extract<SessionInboundMessage, { type: "multica.label.list.request" }>,
  ): void {
    this.#emit({
      type: "multica.label.list.response",
      payload: {
        requestId: msg.requestId,
        labels: this.#store.listLabels().map(labelSummary),
      },
    });
  }

  #handleLabelCreate(
    msg: Extract<SessionInboundMessage, { type: "multica.label.create.request" }>,
  ): void {
    const label = this.#store.createLabel({ name: msg.name, color: msg.color });
    this.#emit({
      type: "multica.label.create.response",
      payload: { requestId: msg.requestId, label: labelSummary(label) },
    });
  }

  #handleLabelUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.label.update.request" }>,
  ): void {
    const label = this.#store.updateLabel(msg.labelId, {
      ...(msg.name !== undefined ? { name: msg.name } : {}),
      ...(msg.color !== undefined ? { color: msg.color } : {}),
    });
    this.#emit({
      type: "multica.label.update.response",
      payload: {
        requestId: msg.requestId,
        label: { id: label.id, name: label.name, color: label.color },
      },
    });
  }

  #handleLabelDelete(
    msg: Extract<SessionInboundMessage, { type: "multica.label.delete.request" }>,
  ): void {
    this.#store.deleteLabel(msg.labelId);
    this.#emit({
      type: "multica.label.delete.response",
      payload: { requestId: msg.requestId, deleted: true },
    });
  }

  #handleIssueLabelsSet(
    msg: Extract<SessionInboundMessage, { type: "multica.issue.labels.set.request" }>,
  ): void {
    this.#store.setIssueLabels(msg.issueId, msg.labelIds);
    this.#emit({
      type: "multica.issue.labels.set.response",
      payload: {
        requestId: msg.requestId,
        labels: this.#store.listLabelsForIssue(msg.issueId).map(labelSummary),
      },
    });
  }

  /**
   * Editing and deleting are the author's own acts: the owner edits and
   * deletes owner-authored comments, a run its own. An author mismatch is
   * refused — the record is public, its revision is not.
   */
  #assertCommentAuthor(commentId: string, senderSessionId: string | undefined): CommentRow {
    const comment = this.#store.getComment(commentId);
    const author = this.#resolveCommentAuthor(senderSessionId);
    const isOwner = comment.authorType === "owner";
    const matches = isOwner
      ? author.type === "owner"
      : author.type === "agent" && author.id === comment.authorId;
    if (!matches) {
      throw new Error("only the comment's author can revise it");
    }
    return comment;
  }

  #handleCommentUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.comment.update.request" }>,
  ): void {
    this.#assertCommentAuthor(msg.commentId, msg.senderSessionId);
    const comment = this.#store.editComment(msg.commentId, msg.content);
    this.#emit({
      type: "multica.comment.update.response",
      payload: {
        requestId: msg.requestId,
        comment: commentSummary(comment, this.#ownerReactions(comment.id)),
      },
    });
  }

  /** Resolve/unresolve as one RPC with a flag: the source's two endpoints
   * share the store shape; attribution follows the comment discipline. */
  #handleCommentResolve(
    msg: Extract<SessionInboundMessage, { type: "multica.comment.resolve.request" }>,
  ): void {
    const author = this.#resolveCommentAuthor(msg.senderSessionId);
    const comment = msg.resolved
      ? this.#store.resolveComment(
          msg.commentId,
          author.type,
          author.type === "agent" ? author.id : "owner",
        )
      : this.#store.unresolveComment(msg.commentId);
    this.#emit({
      type: "multica.comment.resolve.response",
      payload: {
        requestId: msg.requestId,
        comment: commentSummary(comment, this.#ownerReactions(comment.id)),
      },
    });
  }

  #handleCommentDelete(
    msg: Extract<SessionInboundMessage, { type: "multica.comment.delete.request" }>,
  ): void {
    this.#assertCommentAuthor(msg.commentId, msg.senderSessionId);
    this.#store.deleteComment(msg.commentId);
    this.#emit({
      type: "multica.comment.delete.response",
      payload: { requestId: msg.requestId, deleted: true },
    });
  }

  /** The console is the reaction surface; its viewer is the owner. */
  #ownerReactions(commentId: string): MulticaCommentSummary["reactions"] {
    return this.#store.listCommentReactions(commentId, {
      userType: "owner",
      userId: "owner",
    });
  }

  #handleReactionSet(
    msg: Extract<SessionInboundMessage, { type: "multica.reaction.set.request" }>,
  ): void {
    const author = this.#resolveCommentAuthor(msg.senderSessionId);
    const userType = author.type === "agent" ? ("agent" as const) : ("owner" as const);
    const userId = author.type === "owner" ? "owner" : author.id;
    this.#store.setCommentReaction({
      commentId: msg.commentId,
      userType,
      userId,
      emoji: msg.emoji,
      reacted: msg.reacted,
    });
    this.#emit({
      type: "multica.reaction.set.response",
      payload: {
        requestId: msg.requestId,
        reactions: this.#store.listCommentReactions(msg.commentId, {
          userType: "owner",
          userId: "owner",
        }),
      },
    });
  }

  #handleRosterMessage(msg: RosterOrConversationMessage): void {
    switch (msg.type) {
      case "multica.agent.get.request":
        return this.#handleAgentGet(msg);
      case "multica.squad.get.request":
        return this.#handleSquadGet(msg);
      case "multica.squad.list.request":
        return this.#handleSquadList(msg);
      case "multica.comment.list.request":
        return this.#handleCommentList(msg);
      default:
        msg satisfies never;
    }
  }

  #handleAgentGet(
    msg: Extract<SessionInboundMessage, { type: "multica.agent.get.request" }>,
  ): void {
    this.#emit({
      type: "multica.agent.get.response",
      payload: { requestId: msg.requestId, agent: agentDetail(this.#store.getAgent(msg.id)) },
    });
  }

  #handleAgentUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.agent.update.request" }>,
  ): void {
    const agent = this.#store.updateAgent(msg.id, {
      ...(msg.name !== undefined ? { name: msg.name } : {}),
      ...(msg.description !== undefined ? { description: msg.description } : {}),
      ...(msg.maxConcurrentTasks !== undefined
        ? { maxConcurrentTasks: msg.maxConcurrentTasks }
        : {}),
    });
    this.#emit({
      type: "multica.agent.update.response",
      payload: { requestId: msg.requestId, agent: agentSummary(agent) },
    });
  }

  #handleAgentStatus(
    msg: Extract<SessionInboundMessage, { type: "multica.agent.status.request" }>,
  ): void {
    this.#store.setAgentArchived(msg.id, msg.status === "archived");
    this.#emit({
      type: "multica.agent.status.response",
      payload: { requestId: msg.requestId, agent: agentDetail(this.#store.getAgent(msg.id)) },
    });
  }

  #handleSquadGet(
    msg: Extract<SessionInboundMessage, { type: "multica.squad.get.request" }>,
  ): void {
    this.#emit({
      type: "multica.squad.get.response",
      payload: { requestId: msg.requestId, squad: squadDetail(this.#store, msg.id) },
    });
  }

  #handleSquadAddMember(
    msg: Extract<SessionInboundMessage, { type: "multica.squad.add_member.request" }>,
  ): void {
    this.#store.addSquadMember({
      squadId: msg.squadId,
      memberType: msg.memberType,
      memberId: msg.memberId,
      role: msg.role ?? "member",
    });
    this.#emit({
      type: "multica.squad.add_member.response",
      payload: { requestId: msg.requestId, squad: squadDetail(this.#store, msg.squadId) },
    });
  }

  #handleSquadUpdate(
    msg: Extract<SessionInboundMessage, { type: "multica.squad.update.request" }>,
  ): void {
    const squad = this.#store.updateSquad(msg.squadId, {
      ...(msg.name !== undefined ? { name: msg.name } : {}),
      ...(msg.description !== undefined ? { description: msg.description } : {}),
      ...(msg.instructions !== undefined ? { instructions: msg.instructions } : {}),
      ...(msg.leaderId !== undefined ? { leaderId: msg.leaderId } : {}),
    });
    this.#emit({
      type: "multica.squad.update.response",
      payload: { requestId: msg.requestId, squad: squadDetail(this.#store, squad.id) },
    });
  }

  #handleSquadMemberRole(
    msg: Extract<SessionInboundMessage, { type: "multica.squad.member_role.request" }>,
  ): void {
    this.#store.updateSquadMemberRole(msg.squadId, msg.memberType, msg.memberId, msg.role);
    const squad = this.#store.getSquad(msg.squadId);
    this.#emit({
      type: "multica.squad.member_role.response",
      payload: { requestId: msg.requestId, squad: squadDetail(this.#store, squad.id) },
    });
  }

  #handleSquadRemoveMember(
    msg: Extract<SessionInboundMessage, { type: "multica.squad.remove_member.request" }>,
  ): void {
    this.#store.removeSquadMember(msg.squadId, msg.memberType, msg.memberId);
    this.#emit({
      type: "multica.squad.remove_member.response",
      payload: { requestId: msg.requestId, squad: squadDetail(this.#store, msg.squadId) },
    });
  }

  #handleTaskList(
    msg: Extract<SessionInboundMessage, { type: "multica.task.list.request" }>,
  ): void {
    const tasks =
      msg.agentId !== undefined
        ? this.#store.listTasksForAgent(msg.agentId)
        : this.#store.listTasksForIssue(msg.issueId ?? "");
    this.#emit({
      type: "multica.task.list.response",
      payload: { requestId: msg.requestId, tasks: tasks.map(taskSummary) },
    });
  }
}
