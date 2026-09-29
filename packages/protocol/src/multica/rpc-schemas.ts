/**
 * Wire schemas for the multica replica's RPC surface.
 *
 * One domain directory mirroring the repo's per-domain rpc-schemas pattern:
 * requests and responses in pairs, dotted namespace with direction suffixes.
 * The first slice covers the read/write core the console and the CLI need —
 * agent/issue/comment/squad/task list, create, get — shaped to match the
 * store's rows so the handler is a thin translation.
 *
 * Wire types deliberately stay flat: the JSON columns (metadata, properties,
 * context, runtime_config) travel as their TEXT wire form and are parsed by
 * the reader, per the translation rules.
 */
import { z } from "zod";

// ---------------------------------------------------------------- agents

/**
 * The standing workspace the built-in secretary lives in. Shared because two
 * surfaces must agree on it: the daemon seeds a workspace under this title,
 * and the board resolves its front-door entry by it.
 */
export const MULTICA_SECRETARY_WORKSPACE_TITLE = "Chief of Staff";

export const MulticaAgentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  status: z.string(),
  description: z.string(),
  instructions: z.string(),
  kind: z.string(),
  systemKey: z.string().nullable(),
  permissionMode: z.string(),
  maxConcurrentTasks: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  model: z.string().nullable(),
});

export const MulticaAgentListRequestSchema = z.object({
  type: z.literal("multica.agent.list.request"),
  requestId: z.string(),
  includeArchived: z.boolean().optional(),
  /** Include hidden system-kind agents (built-ins like the secretary). */
  includeSystem: z.boolean().optional(),
});

export const MulticaAgentListResponseSchema = z.object({
  type: z.literal("multica.agent.list.response"),
  payload: z.object({
    requestId: z.string(),
    agents: z.array(MulticaAgentSummarySchema),
  }),
});

export const MulticaAgentCreateRequestSchema = z.object({
  type: z.literal("multica.agent.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  description: z.string().max(255).optional(),
  instructions: z.string().optional(),
});

export const MulticaAgentCreateResponseSchema = z.object({
  type: z.literal("multica.agent.create.response"),
  payload: z.object({
    requestId: z.string(),
    agent: MulticaAgentSummarySchema,
  }),
});

// ---------------------------------------------------------------- issues

export const MulticaLabelSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export const MulticaIssueSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  assigneeType: z.string().nullable(),
  assigneeId: z.string().nullable(),
  creatorType: z.string(),
  creatorId: z.string(),
  number: z.number().int().nullable(),
  projectId: z.string().nullable(),
  revision: z.number().int(),
  position: z.number(),
  labels: z.array(MulticaLabelSummarySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().nullable(),
});

export const MulticaIssueMineRequestSchema = z.object({
  type: z.literal("multica.issue.mine.request"),
  requestId: z.string(),
  // Additive: the source's four scopes. "subscribed" stays as the old name
  // of the involved relation so an old client's request still parses.
  scope: z.enum(["assigned", "created", "subscribed", "all", "involved"]),
});
export const MulticaIssueMineResponseSchema = z.object({
  type: z.literal("multica.issue.mine.response"),
  payload: z.object({
    requestId: z.string(),
    // Additive: the source's four scopes. "subscribed" stays as the old name
    // of the involved relation so an old client's request still parses.
    scope: z.enum(["assigned", "created", "subscribed", "all", "involved"]),
    issues: z.array(MulticaIssueSummarySchema),
  }),
});

export const MulticaIssueListRequestSchema = z.object({
  type: z.literal("multica.issue.list.request"),
  requestId: z.string(),
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
});

export const MulticaIssueListResponseSchema = z.object({
  type: z.literal("multica.issue.list.response"),
  payload: z.object({
    requestId: z.string(),
    issues: z.array(MulticaIssueSummarySchema),
  }),
});

export const MulticaIssueCreateRequestSchema = z.object({
  type: z.literal("multica.issue.create.request"),
  requestId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeType: z.string().optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
  parentIssueId: z.string().optional(),
});

export const MulticaIssueCreateResponseSchema = z.object({
  type: z.literal("multica.issue.create.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
  }),
});

export const MulticaIssueGetRequestSchema = z.object({
  type: z.literal("multica.issue.get.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});

export const MulticaIssueGetResponseSchema = z.object({
  type: z.literal("multica.issue.get.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
    /** The parent's children — the sub-issues read face. */
    children: z.array(MulticaIssueSummarySchema),
  }),
});

export const MulticaIssueDeleteRequestSchema = z.object({
  type: z.literal("multica.issue.delete.request"),
  requestId: z.string(),
  id: z.string().min(1),
});
export const MulticaIssueDeleteResponseSchema = z.object({
  type: z.literal("multica.issue.delete.response"),
  payload: z.object({ requestId: z.string(), deleted: z.boolean() }),
});

export const MulticaIssueBatchUpdateRequestSchema = z.object({
  type: z.literal("multica.issue.batch_update.request"),
  requestId: z.string(),
  ids: z.array(z.string().min(1)).min(1),
  /** Per-issue revision the caller read; absent rows read fresh. */
  expectedRevisions: z.record(z.string(), z.number().int()).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeType: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
});
export const MulticaIssueBatchUpdateResponseSchema = z.object({
  type: z.literal("multica.issue.batch_update.response"),
  payload: z.object({ requestId: z.string(), issues: z.array(MulticaIssueSummarySchema) }),
});

export const MulticaIssueBatchDeleteRequestSchema = z.object({
  type: z.literal("multica.issue.batch_delete.request"),
  requestId: z.string(),
  ids: z.array(z.string().min(1)).min(1),
});
export const MulticaIssueBatchDeleteResponseSchema = z.object({
  type: z.literal("multica.issue.batch_delete.response"),
  payload: z.object({ requestId: z.string(), deleted: z.number().int() }),
});

export const MulticaIssueStatusUpdateRequestSchema = z.object({
  type: z.literal("multica.issue.status.update.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  status: z.string().min(1),
  /** The revision the caller read — optimistic concurrency. */
  expectedRevision: z.number().int().positive(),
  senderSessionId: z.string().optional(),
});

export const MulticaIssueStatusUpdateResponseSchema = z.object({
  type: z.literal("multica.issue.status.update.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
  }),
});

// ---------------------------------------------------------------- comments

export const MulticaCommentSummarySchema = z.object({
  id: z.string(),
  issueId: z.string(),
  authorType: z.string(),
  authorId: z.string(),
  content: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int(),
  sourceTaskId: z.string().nullable(),
  deletedAt: z.string().nullable(),
  /** The thread's resolution stamp; fold and the banner read it. Additive. */
  resolvedAt: z.string().nullable(),
  reactions: z.array(
    z.object({ emoji: z.string(), count: z.number(), reactedByViewer: z.boolean() }),
  ),
});

export const MulticaLabelListRequestSchema = z.object({
  type: z.literal("multica.label.list.request"),
  requestId: z.string(),
});
export const MulticaLabelListResponseSchema = z.object({
  type: z.literal("multica.label.list.response"),
  payload: z.object({ requestId: z.string(), labels: z.array(MulticaLabelSummarySchema) }),
});

export const MulticaLabelUpdateRequestSchema = z.object({
  type: z.literal("multica.label.update.request"),
  requestId: z.string(),
  labelId: z.string().min(1),
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
});
export const MulticaLabelUpdateResponseSchema = z.object({
  type: z.literal("multica.label.update.response"),
  payload: z.object({ requestId: z.string(), label: MulticaLabelSummarySchema }),
});

export const MulticaLabelDeleteRequestSchema = z.object({
  type: z.literal("multica.label.delete.request"),
  requestId: z.string(),
  labelId: z.string().min(1),
});
export const MulticaLabelDeleteResponseSchema = z.object({
  type: z.literal("multica.label.delete.response"),
  payload: z.object({ requestId: z.string(), deleted: z.boolean() }),
});

export const MulticaLabelCreateRequestSchema = z.object({
  type: z.literal("multica.label.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  color: z.string().min(1),
});
export const MulticaLabelCreateResponseSchema = z.object({
  type: z.literal("multica.label.create.response"),
  payload: z.object({ requestId: z.string(), label: MulticaLabelSummarySchema }),
});

export const MulticaIssueLabelsSetRequestSchema = z.object({
  type: z.literal("multica.issue.labels.set.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  labelIds: z.array(z.string()),
});
export const MulticaIssueLabelsSetResponseSchema = z.object({
  type: z.literal("multica.issue.labels.set.response"),
  payload: z.object({ requestId: z.string(), labels: z.array(MulticaLabelSummarySchema) }),
});

export const MulticaCommentUpdateRequestSchema = z.object({
  type: z.literal("multica.comment.update.request"),
  requestId: z.string(),
  commentId: z.string().min(1),
  content: z.string(),
  senderSessionId: z.string().optional(),
});
export const MulticaCommentUpdateResponseSchema = z.object({
  type: z.literal("multica.comment.update.response"),
  payload: z.object({ requestId: z.string(), comment: MulticaCommentSummarySchema }),
});

export const MulticaCommentResolveRequestSchema = z.object({
  type: z.literal("multica.comment.resolve.request"),
  requestId: z.string(),
  commentId: z.string().min(1),
  resolved: z.boolean(),
  senderSessionId: z.string().optional(),
});
export const MulticaCommentResolveResponseSchema = z.object({
  type: z.literal("multica.comment.resolve.response"),
  payload: z.object({ requestId: z.string(), comment: MulticaCommentSummarySchema }),
});

export const MulticaCommentDeleteRequestSchema = z.object({
  type: z.literal("multica.comment.delete.request"),
  requestId: z.string(),
  commentId: z.string().min(1),
  senderSessionId: z.string().optional(),
});
export const MulticaCommentDeleteResponseSchema = z.object({
  type: z.literal("multica.comment.delete.response"),
  payload: z.object({ requestId: z.string(), deleted: z.boolean() }),
});

export const MulticaReactionSetRequestSchema = z.object({
  type: z.literal("multica.reaction.set.request"),
  requestId: z.string(),
  commentId: z.string().min(1),
  emoji: z.string().min(1),
  reacted: z.boolean(),
  /** The reacting session; absent means the owner. */
  senderSessionId: z.string().optional(),
});
export const MulticaReactionSetResponseSchema = z.object({
  type: z.literal("multica.reaction.set.response"),
  payload: z.object({
    requestId: z.string(),
    reactions: z.array(
      z.object({ emoji: z.string(), count: z.number(), reactedByViewer: z.boolean() }),
    ),
  }),
});

export const MulticaCommentListRequestSchema = z.object({
  type: z.literal("multica.comment.list.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});

export const MulticaCommentListResponseSchema = z.object({
  type: z.literal("multica.comment.list.response"),
  payload: z.object({
    requestId: z.string(),
    comments: z.array(MulticaCommentSummarySchema),
  }),
});

export const MulticaCommentCreateRequestSchema = z.object({
  type: z.literal("multica.comment.create.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  content: z.string().min(1),
  parentId: z.string().optional(),
  /**
   * The session the sender speaks from. An agent session is reverse-resolved
   * to its run and the comment attributes to the run's agent; absent means a
   * human (the owner). A value that resolves to no run is refused — an agent
   * speaks on an issue only through a run.
   */
  senderSessionId: z.string().optional(),
});

export const MulticaCommentCreateResponseSchema = z.object({
  type: z.literal("multica.comment.create.response"),
  payload: z.object({
    requestId: z.string(),
    comment: MulticaCommentSummarySchema,
  }),
});

export const MulticaAgentDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  systemKey: z.string().nullable(),
  status: z.string(),
  description: z.string(),
  instructions: z.string(),
  model: z.string().nullable(),
  /** Env rows as stored JSON text; the executor parses it for each run. */
  customEnv: z.string().nullable(),
  permissionMode: z.string(),
  maxConcurrentTasks: z.number(),
  thinkingLevel: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MulticaSquadDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  leaderId: z.string(),
  instructions: z.string(),
  members: z.array(
    z.object({
      memberType: z.string(),
      memberId: z.string(),
      role: z.string(),
    }),
  ),
});

export const MulticaAgentGetRequestSchema = z.object({
  type: z.literal("multica.agent.get.request"),
  requestId: z.string(),
  id: z.string().min(1),
});
export const MulticaAgentGetResponseSchema = z.object({
  type: z.literal("multica.agent.get.response"),
  payload: z.object({ requestId: z.string(), agent: MulticaAgentDetailSchema }),
});

export const MulticaAgentUpdateRequestSchema = z.object({
  type: z.literal("multica.agent.update.request"),
  requestId: z.string(),
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  maxConcurrentTasks: z.number().int().optional(),
  /** The model override the run's session carries. */
  model: z.string().nullable().optional(),
  /** Extra env rows for the run, validated as an object on the wire. */
  customEnv: z.record(z.string(), z.string()).nullable().optional(),
});
export const MulticaAgentUpdateResponseSchema = z.object({
  type: z.literal("multica.agent.update.response"),
  payload: z.object({ requestId: z.string(), agent: MulticaAgentSummarySchema }),
});

export const MulticaAgentStatusRequestSchema = z.object({
  type: z.literal("multica.agent.status.request"),
  requestId: z.string(),
  id: z.string().min(1),
  /** The source's switch is archive/restore, not presence status. */
  status: z.enum(["active", "archived"]),
});
export const MulticaAgentStatusResponseSchema = z.object({
  type: z.literal("multica.agent.status.response"),
  payload: z.object({ requestId: z.string(), agent: MulticaAgentDetailSchema }),
});

export const MulticaSquadGetRequestSchema = z.object({
  type: z.literal("multica.squad.get.request"),
  requestId: z.string(),
  id: z.string().min(1),
});
export const MulticaSquadGetResponseSchema = z.object({
  type: z.literal("multica.squad.get.response"),
  payload: z.object({ requestId: z.string(), squad: MulticaSquadDetailSchema }),
});

export const MulticaSquadAddMemberRequestSchema = z.object({
  type: z.literal("multica.squad.add_member.request"),
  requestId: z.string(),
  squadId: z.string().min(1),
  memberType: z.string().min(1),
  memberId: z.string().min(1),
  role: z.string().optional(),
});
export const MulticaSquadAddMemberResponseSchema = z.object({
  type: z.literal("multica.squad.add_member.response"),
  payload: z.object({ requestId: z.string(), squad: MulticaSquadDetailSchema }),
});

export const MulticaSquadRemoveMemberRequestSchema = z.object({
  type: z.literal("multica.squad.remove_member.request"),
  requestId: z.string(),
  squadId: z.string().min(1),
  memberType: z.string().min(1),
  memberId: z.string().min(1),
});
export const MulticaSquadRemoveMemberResponseSchema = z.object({
  type: z.literal("multica.squad.remove_member.response"),
  payload: z.object({ requestId: z.string(), squad: MulticaSquadDetailSchema }),
});

export const MulticaSubscriberSummarySchema = z.object({
  userType: z.string(),
  userId: z.string(),
  reason: z.string(),
});

export const MulticaSubscriberListRequestSchema = z.object({
  type: z.literal("multica.subscriber.list.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});
export const MulticaSubscriberListResponseSchema = z.object({
  type: z.literal("multica.subscriber.list.response"),
  payload: z.object({
    requestId: z.string(),
    subscribers: z.array(MulticaSubscriberSummarySchema),
  }),
});

export const MulticaSubscriberSetRequestSchema = z.object({
  type: z.literal("multica.subscriber.set.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  subscribed: z.boolean(),
  /** The subscribing session; absent means the owner. */
  senderSessionId: z.string().optional(),
});
export const MulticaSubscriberSetResponseSchema = z.object({
  type: z.literal("multica.subscriber.set.response"),
  payload: z.object({
    requestId: z.string(),
    subscribers: z.array(MulticaSubscriberSummarySchema),
  }),
});

export const MulticaTimelineEntrySchema = z.object({
  /** The discriminator the detail stream renders on. */
  kind: z.enum(["activity", "comment"]),
  id: z.string(),
  createdAt: z.string(),
  /** activity: what happened. */
  action: z.string().nullable(),
  actorType: z.string().nullable(),
  actorId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  /** comment: what was said. */
  content: z.string().nullable(),
  authorType: z.string().nullable(),
  authorId: z.string().nullable(),
  /** comment: the thread root it answers; null means it is itself a root. Additive. */
  parentId: z.string().nullable(),
  /** comment: its reaction counts, viewer-relative. */
  reactions: z
    .array(z.object({ emoji: z.string(), count: z.number(), reactedByViewer: z.boolean() }))
    .nullable(),
  /** comment: tombstoned when deleted with replies still hanging off it. */
  deletedAt: z.string().nullable(),
  /** comment: the thread's resolution stamp; fold and banner read it. Additive. */
  resolvedAt: z.string().nullable(),
});

export const MulticaTimelineListRequestSchema = z.object({
  type: z.literal("multica.timeline.list.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});
export const MulticaTimelineListResponseSchema = z.object({
  type: z.literal("multica.timeline.list.response"),
  payload: z.object({
    requestId: z.string(),
    entries: z.array(MulticaTimelineEntrySchema),
    truncated: z.boolean(),
  }),
});

export const MulticaAutopilotTriggerSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  enabled: z.boolean(),
  cronExpression: z.string().nullable(),
  timezone: z.string(),
  nextRunAt: z.string().nullable(),
  label: z.string().nullable(),
});

export const MulticaAutopilotSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  assigneeType: z.string(),
  assigneeId: z.string(),
  status: z.string(),
  executionMode: z.string(),
  issueTitleTemplate: z.string().nullable(),
  concurrencyPolicy: z.string(),
  lastRunAt: z.string().nullable(),
  triggers: z.array(MulticaAutopilotTriggerSummarySchema),
});

export const MulticaAutopilotRunSummarySchema = z.object({
  id: z.string(),
  autopilotId: z.string(),
  source: z.string(),
  status: z.string(),
  issueId: z.string().nullable(),
  taskId: z.string().nullable(),
  triggeredAt: z.string(),
  failureReason: z.string().nullable(),
});

export const MulticaAutopilotListRequestSchema = z.object({
  type: z.literal("multica.autopilot.list.request"),
  requestId: z.string(),
});
export const MulticaAutopilotListResponseSchema = z.object({
  type: z.literal("multica.autopilot.list.response"),
  payload: z.object({
    requestId: z.string(),
    autopilots: z.array(MulticaAutopilotSummarySchema),
  }),
});

export const MulticaAutopilotCreateRequestSchema = z.object({
  type: z.literal("multica.autopilot.create.request"),
  requestId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeType: z.enum(["agent", "squad"]),
  assigneeId: z.string().min(1),
  executionMode: z.enum(["create_issue", "run_only"]),
  issueTitleTemplate: z.string().optional(),
  concurrencyPolicy: z.enum(["skip", "queue"]).optional(),
  /** Optional schedule trigger: cron expression plus timezone. */
  cron: z.string().optional(),
  timezone: z.string().optional(),
});
export const MulticaAutopilotCreateResponseSchema = z.object({
  type: z.literal("multica.autopilot.create.response"),
  payload: z.object({
    requestId: z.string(),
    autopilot: MulticaAutopilotSummarySchema,
  }),
});

export const MulticaAutopilotTriggerRequestSchema = z.object({
  type: z.literal("multica.autopilot.trigger.request"),
  requestId: z.string(),
  id: z.string().min(1),
});
export const MulticaAutopilotTriggerResponseSchema = z.object({
  type: z.literal("multica.autopilot.trigger.response"),
  payload: z.object({
    requestId: z.string(),
    run: MulticaAutopilotRunSummarySchema,
    fired: z.boolean(),
    reason: z.string().nullable(),
  }),
});

export const MulticaAutopilotStatusRequestSchema = z.object({
  type: z.literal("multica.autopilot.status.request"),
  requestId: z.string(),
  id: z.string().min(1),
  status: z.enum(["active", "paused", "archived"]),
  pauseReason: z.string().optional(),
});
export const MulticaAutopilotStatusResponseSchema = z.object({
  type: z.literal("multica.autopilot.status.response"),
  payload: z.object({ requestId: z.string(), autopilot: MulticaAutopilotSummarySchema }),
});

export const MulticaAutopilotTriggerCreateRequestSchema = z.object({
  type: z.literal("multica.autopilot.trigger_create.request"),
  requestId: z.string(),
  autopilotId: z.string().min(1),
  // Schedule only: a webhook or api row without its dispatch surface would
  // be a trigger that can never fire.
  cronExpression: z.string().min(1),
  timezone: z.string().optional(),
  label: z.string().optional(),
});
export const MulticaAutopilotTriggerCreateResponseSchema = z.object({
  type: z.literal("multica.autopilot.trigger_create.response"),
  payload: z.object({ requestId: z.string(), trigger: MulticaAutopilotTriggerSummarySchema }),
});

export const MulticaAutopilotTriggerDeleteRequestSchema = z.object({
  type: z.literal("multica.autopilot.trigger_delete.request"),
  requestId: z.string(),
  id: z.string().min(1),
});
export const MulticaAutopilotTriggerDeleteResponseSchema = z.object({
  type: z.literal("multica.autopilot.trigger_delete.response"),
  payload: z.object({ requestId: z.string(), deleted: z.boolean() }),
});

export const MulticaAutopilotRunsRequestSchema = z.object({
  type: z.literal("multica.autopilot.runs.request"),
  requestId: z.string(),
  id: z.string().min(1),
});
export const MulticaAutopilotRunsResponseSchema = z.object({
  type: z.literal("multica.autopilot.runs.response"),
  payload: z.object({
    requestId: z.string(),
    runs: z.array(MulticaAutopilotRunSummarySchema),
  }),
});

export const MulticaInboxItemSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.string(),
  issueId: z.string().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  read: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
  actorType: z.string().nullable(),
  actorId: z.string().nullable(),
});

export const MulticaInboxListRequestSchema = z.object({
  type: z.literal("multica.inbox.list.request"),
  requestId: z.string(),
  archived: z.boolean().optional(),
  /**
   * A session asking on the owner's behalf: when it resolves to a run, the
   * request is refused — the owner's queue has no agent read or filing
   * surface in the source, and an agent filing the owner's items empties
   * the desk it was put on.
   */
  senderSessionId: z.string().optional(),
});
export const MulticaInboxListResponseSchema = z.object({
  type: z.literal("multica.inbox.list.response"),
  payload: z.object({
    requestId: z.string(),
    items: z.array(MulticaInboxItemSummarySchema),
    unread: z.number().int(),
  }),
});
export const MulticaInboxCreateRequestSchema = z.object({
  type: z.literal("multica.inbox.create.request"),
  requestId: z.string(),
  severity: z.enum(["action_required", "attention", "info"]),
  issueId: z.string().optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  /** Only a run may write the owner's inbox; resolves like a comment author. */
  senderSessionId: z.string(),
});
export const MulticaInboxCreateResponseSchema = z.object({
  type: z.literal("multica.inbox.create.response"),
  payload: z.object({ requestId: z.string(), item: MulticaInboxItemSummarySchema }),
});
export const MulticaInboxMarkRequestSchema = z.object({
  type: z.literal("multica.inbox.mark.request"),
  requestId: z.string(),
  id: z.string().min(1),
  read: z.boolean(),
  /**
   * A session asking on the owner's behalf: when it resolves to a run, the
   * request is refused — the owner's queue has no agent read or filing
   * surface in the source, and an agent filing the owner's items empties
   * the desk it was put on.
   */
  senderSessionId: z.string().optional(),
});
export const MulticaInboxMarkResponseSchema = z.object({
  type: z.literal("multica.inbox.mark.response"),
  payload: z.object({ requestId: z.string(), item: MulticaInboxItemSummarySchema }),
});
export const MulticaInboxArchiveRequestSchema = z.object({
  type: z.literal("multica.inbox.archive.request"),
  requestId: z.string(),
  id: z.string().min(1),
  archived: z.boolean(),
  /**
   * A session asking on the owner's behalf: when it resolves to a run, the
   * request is refused — the owner's queue has no agent read or filing
   * surface in the source, and an agent filing the owner's items empties
   * the desk it was put on.
   */
  senderSessionId: z.string().optional(),
});
export const MulticaInboxArchiveResponseSchema = z.object({
  type: z.literal("multica.inbox.archive.response"),
  payload: z.object({ requestId: z.string(), item: MulticaInboxItemSummarySchema }),
});
export const MulticaInboxMarkAllRequestSchema = z.object({
  type: z.literal("multica.inbox.mark_all.request"),
  requestId: z.string(),
  /**
   * A session asking on the owner's behalf: when it resolves to a run, the
   * request is refused — the owner's queue has no agent read or filing
   * surface in the source, and an agent filing the owner's items empties
   * the desk it was put on.
   */
  senderSessionId: z.string().optional(),
});
export const MulticaInboxMarkAllResponseSchema = z.object({
  type: z.literal("multica.inbox.mark_all.response"),
  payload: z.object({ requestId: z.string(), changed: z.number().int() }),
});

export const MulticaInboxArchiveAllRequestSchema = z.object({
  type: z.literal("multica.inbox.archive_all.request"),
  requestId: z.string(),
  /** Only read items, as the source's archive-all-read verb does. */
  readOnly: z.boolean().optional(),
  senderSessionId: z.string().optional(),
});
export const MulticaInboxArchiveAllResponseSchema = z.object({
  type: z.literal("multica.inbox.archive_all.response"),
  payload: z.object({ requestId: z.string(), changed: z.number().int() }),
});

export const MulticaWakeupSummarySchema = z.object({
  id: z.string(),
  issueId: z.string(),
  agentId: z.string(),
  instruction: z.string(),
  kind: z.string(),
  mode: z.string(),
  eventTypes: z.array(z.string()),
  nextFireAt: z.string().nullable(),
  enabled: z.boolean(),
  revision: z.number().int(),
});

export const MulticaWakeupListRequestSchema = z.object({
  type: z.literal("multica.wakeup.list.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});

export const MulticaWakeupListResponseSchema = z.object({
  type: z.literal("multica.wakeup.list.response"),
  payload: z.object({ requestId: z.string(), wakeups: z.array(MulticaWakeupSummarySchema) }),
});

export const MulticaWakeupCreateRequestSchema = z.object({
  type: z.literal("multica.wakeup.create.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  agentId: z.string().min(1),
  instruction: z.string().min(1).max(12_000),
  kind: z.enum(["event", "at", "every", "cron"]),
  mode: z.enum(["once", "continuous"]),
  eventTypes: z.array(z.string()).optional(),
  intervalSeconds: z.number().int().positive().optional(),
  cronExpression: z.string().optional(),
  timezone: z.string().optional(),
  at: z.string().optional(),
  /** The session the registering caller speaks from; resolves to its run. */
  senderSessionId: z.string().optional(),
});

export const MulticaWakeupCreateResponseSchema = z.object({
  type: z.literal("multica.wakeup.create.response"),
  payload: z.object({ requestId: z.string(), wakeup: MulticaWakeupSummarySchema }),
});

export const MulticaWakeupWorkspaceListRequestSchema = z.object({
  type: z.literal("multica.wakeup.workspace_list.request"),
  requestId: z.string(),
});
export const MulticaWakeupWorkspaceListResponseSchema = z.object({
  type: z.literal("multica.wakeup.workspace_list.response"),
  payload: z.object({
    requestId: z.string(),
    wakeups: z.array(MulticaWakeupSummarySchema.extend({ issueTitle: z.string().nullable() })),
  }),
});

export const MulticaWakeupEnableRequestSchema = z.object({
  type: z.literal("multica.wakeup.enable.request"),
  requestId: z.string(),
  id: z.string().min(1),
  senderSessionId: z.string().optional(),
});
export const MulticaWakeupEnableResponseSchema = z.object({
  type: z.literal("multica.wakeup.enable.response"),
  payload: z.object({ requestId: z.string(), wakeup: MulticaWakeupSummarySchema }),
});

// senderSessionId is additive: it lets the daemon require a live human
// originator — the source refuses these writes from a finished run, and an
// old client simply sends no session and reads as the owner surface.
export const MulticaWakeupDisableRequestSchema = z.object({
  type: z.literal("multica.wakeup.disable.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  id: z.string().min(1),
  senderSessionId: z.string().optional(),
});

export const MulticaWakeupDisableResponseSchema = z.object({
  type: z.literal("multica.wakeup.disable.response"),
  payload: z.object({ requestId: z.string(), wakeup: MulticaWakeupSummarySchema }),
});

export const MulticaStatusSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  category: z.string(),
  color: z.string(),
  isSystem: z.boolean(),
  position: z.number(),
});

export const MulticaStatusListRequestSchema = z.object({
  type: z.literal("multica.status.list.request"),
  requestId: z.string(),
});

export const MulticaStatusListResponseSchema = z.object({
  type: z.literal("multica.status.list.response"),
  payload: z.object({
    requestId: z.string(),
    statuses: z.array(MulticaStatusSummarySchema),
  }),
});

export const MulticaIssueUpdateRequestSchema = z.object({
  type: z.literal("multica.issue.update.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  /** The revision the caller read — optimistic concurrency. */
  expectedRevision: z.number().int().positive(),
  /**
   * The writing session; resolved to an agent, or refused when it names a
   * non-run. Absent means the owner, same rule as comment.create.
   */
  senderSessionId: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeType: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  /**
   * The drag's drop slot: an explicit position wins over the re-rank a bare
   * status change performs (the source's UpdateIssue CASE, first branch).
   */
  position: z.number().optional(),
});

export const MulticaIssueUpdateResponseSchema = z.object({
  type: z.literal("multica.issue.update.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
  }),
});

// ---------------------------------------------------------------- squads

export const MulticaSquadSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  leaderId: z.string(),
  instructions: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MulticaSquadMemberSummarySchema = z.object({
  id: z.string(),
  squadId: z.string(),
  memberType: z.string(),
  memberId: z.string(),
  role: z.string(),
});

export const MulticaSquadUpdateRequestSchema = z.object({
  type: z.literal("multica.squad.update.request"),
  requestId: z.string(),
  squadId: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  leaderId: z.string().optional(),
});
export const MulticaSquadUpdateResponseSchema = z.object({
  type: z.literal("multica.squad.update.response"),
  payload: z.object({ requestId: z.string(), squad: MulticaSquadDetailSchema }),
});

export const MulticaSquadMemberRoleRequestSchema = z.object({
  type: z.literal("multica.squad.member_role.request"),
  requestId: z.string(),
  squadId: z.string().min(1),
  memberType: z.string().min(1),
  memberId: z.string().min(1),
  role: z.string(),
});
export const MulticaSquadMemberRoleResponseSchema = z.object({
  type: z.literal("multica.squad.member_role.response"),
  payload: z.object({ requestId: z.string(), squad: MulticaSquadDetailSchema }),
});

export const MulticaSquadListRequestSchema = z.object({
  type: z.literal("multica.squad.list.request"),
  requestId: z.string(),
});

export const MulticaSquadListResponseSchema = z.object({
  type: z.literal("multica.squad.list.response"),
  payload: z.object({
    requestId: z.string(),
    squads: z.array(MulticaSquadSummarySchema),
  }),
});

export const MulticaSquadCreateRequestSchema = z.object({
  type: z.literal("multica.squad.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  leaderId: z.string().min(1),
  members: z
    .array(z.object({ memberType: z.enum(["agent", "owner"]), memberId: z.string() }))
    .optional(),
});

export const MulticaSquadCreateResponseSchema = z.object({
  type: z.literal("multica.squad.create.response"),
  payload: z.object({
    requestId: z.string(),
    squad: MulticaSquadSummarySchema,
    members: z.array(MulticaSquadMemberSummarySchema),
  }),
});

// ---------------------------------------------------------------- tasks

export const MulticaTaskSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  // run_only autopilot tasks carry no issue (033 made it representable).
  issueId: z.string().nullable(),
  status: z.string(),
  isLeaderTask: z.boolean(),
  squadId: z.string().nullable(),
  triggerCommentId: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const MulticaTaskRunningListRequestSchema = z.object({
  type: z.literal("multica.task.running.list.request"),
  requestId: z.string(),
});

export const MulticaTaskRunningListResponseSchema = z.object({
  type: z.literal("multica.task.running.list.response"),
  payload: z.object({
    requestId: z.string(),
    tasks: z.array(MulticaTaskSummarySchema),
  }),
});

export const MulticaTaskListRequestSchema = z.object({
  type: z.literal("multica.task.list.request"),
  requestId: z.string(),
  issueId: z.string().min(1).optional(),
  /** An agent's own recent queue history — the detail page's feed. */
  agentId: z.string().min(1).optional(),
});

export const MulticaTaskListResponseSchema = z.object({
  type: z.literal("multica.task.list.response"),
  payload: z.object({
    requestId: z.string(),
    tasks: z.array(MulticaTaskSummarySchema),
  }),
});

// ------------------------------------------------------------ inferred types

export type MulticaAgentSummary = z.infer<typeof MulticaAgentSummarySchema>;
export type MulticaIssueSummary = z.infer<typeof MulticaIssueSummarySchema>;
export type MulticaCommentSummary = z.infer<typeof MulticaCommentSummarySchema>;
export type MulticaSquadSummary = z.infer<typeof MulticaSquadSummarySchema>;
export type MulticaSquadMemberSummary = z.infer<typeof MulticaSquadMemberSummarySchema>;
export type MulticaStatusSummary = z.infer<typeof MulticaStatusSummarySchema>;
export type MulticaInboxItemSummary = z.infer<typeof MulticaInboxItemSummarySchema>;
export type MulticaAutopilotSummary = z.infer<typeof MulticaAutopilotSummarySchema>;
export type MulticaTimelineEntry = z.infer<typeof MulticaTimelineEntrySchema>;
export type MulticaAgentDetail = z.infer<typeof MulticaAgentDetailSchema>;
export type MulticaLabelSummary = z.infer<typeof MulticaLabelSummarySchema>;
export type MulticaReactionSummary = z.infer<
  typeof MulticaCommentSummarySchema
>["reactions"][number];
export type MulticaSquadDetail = z.infer<typeof MulticaSquadDetailSchema>;
export type MulticaAutopilotRunSummary = z.infer<typeof MulticaAutopilotRunSummarySchema>;
export type MulticaWakeupSummary = z.infer<typeof MulticaWakeupSummarySchema>;
export type MulticaTaskSummary = z.infer<typeof MulticaTaskSummarySchema>;
