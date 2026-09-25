import { z } from "zod";

/**
 * Wire schemas for the worker domain.
 *
 * Follows `docs/rpc-namespacing.md`: dotted namespaces with `.request` pairs
 * answering `.response`. Two namespaces cover the first slice:
 *
 * - `worker.template.*` — read-only role catalog
 * - `worker.worker.*`   — worker and task lifecycle
 *
 * Requests keep parameters at the top level and carry a `requestId`; responses
 * nest their result under `payload` so correlated data is unambiguous.
 *
 * Backward compatibility (`docs/protocol-compatibility.md`): these are new
 * namespaces, so nothing here narrows or removes an existing field. Old clients
 * simply never send them.
 */

export const WorkerTemplatePartSchema = z.enum(["IDENTITY", "PERSONA", "BIBLE"]);

export const WorkerTemplateSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The role's one-line summary, from its own identity document. */
  description: z.string(),
  /** Skill ids the role ships with, sorted. */
  skills: z.array(z.string()),
});

export const WorkerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  templateId: z.string(),
  workspacePath: z.string(),
  status: z.enum(["online", "offline"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkerTaskSummarySchema = z.object({
  taskId: z.string(),
  workerId: z.string(),
  title: z.string(),
  /**
   * The session that ran this task, once it has one.
   *
   * Null before the first run. A client uses it to open the task's
   * conversation, which is the same session the run happened in.
   */
  agentId: z.string().nullable(),
  state: z.enum([
    "planned",
    "prepared",
    "assigned",
    "in_progress",
    "submitted",
    "completed",
    "revision",
    "blocked",
    "cancelled",
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkerTaskHistoryEntrySchema = z.object({
  seq: z.number().int().positive(),
  fromState: WorkerTaskSummarySchema.shape.state,
  toState: WorkerTaskSummarySchema.shape.state,
  action: z.string(),
  actor: z.string(),
  note: z.string(),
  recordedAt: z.string(),
});

export const GuardSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);

export const GuardFindingSchema = z.object({
  ruleId: z.string(),
  category: z.string(),
  severity: GuardSeveritySchema,
  description: z.string(),
  remediation: z.string(),
  matchedPattern: z.string(),
  snippet: z.string(),
});

export const GuardDecisionSchema = z.enum(["allow", "confirm", "block"]);

// ---------------------------------------------------------------- templates

export const WorkerTemplateListRequestSchema = z.object({
  type: z.literal("worker.template.list.request"),
  requestId: z.string(),
});

export const WorkerTemplateListResponseSchema = z.object({
  type: z.literal("worker.template.list.response"),
  payload: z.object({
    requestId: z.string(),
    templates: z.array(WorkerTemplateSummarySchema),
  }),
});

// ------------------------------------------------------------------ workers

export const WorkerListRequestSchema = z.object({
  type: z.literal("worker.worker.list.request"),
  requestId: z.string(),
});

export const WorkerListResponseSchema = z.object({
  type: z.literal("worker.worker.list.response"),
  payload: z.object({
    requestId: z.string(),
    workers: z.array(WorkerSummarySchema),
  }),
});

export const WorkerCreateRequestSchema = z.object({
  type: z.literal("worker.worker.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  templateId: z.string().min(1),
  /** Defaults to a daemon-managed directory when omitted. */
  workspacePath: z.string().min(1).optional(),
});

export const WorkerCreateResponseSchema = z.object({
  type: z.literal("worker.worker.create.response"),
  payload: z.object({
    requestId: z.string(),
    worker: WorkerSummarySchema,
  }),
});

export const WorkerGetRequestSchema = z.object({
  type: z.literal("worker.worker.get.request"),
  requestId: z.string(),
  workerId: z.string().min(1),
});

export const WorkerGetResponseSchema = z.object({
  type: z.literal("worker.worker.get.response"),
  payload: z.object({
    requestId: z.string(),
    worker: WorkerSummarySchema,
    tasks: z.array(WorkerTaskSummarySchema),
  }),
});

// -------------------------------------------------------------------- tasks

export const WorkerTaskCreateRequestSchema = z.object({
  type: z.literal("worker.task.create.request"),
  requestId: z.string(),
  workerId: z.string().min(1),
  title: z.string().min(1),
});

export const WorkerTaskCreateResponseSchema = z.object({
  type: z.literal("worker.task.create.response"),
  payload: z.object({
    requestId: z.string(),
    task: WorkerTaskSummarySchema,
  }),
});

export const WorkerTaskTransitionRequestSchema = z.object({
  type: z.literal("worker.task.transition.request"),
  requestId: z.string(),
  taskId: z.string().min(1),
  toState: WorkerTaskSummarySchema.shape.state,
  action: z.string().min(1),
  actor: z.string().min(1),
  note: z.string().optional(),
});

export const WorkerTaskTransitionResponseSchema = z.object({
  type: z.literal("worker.task.transition.response"),
  payload: z.object({
    requestId: z.string(),
    task: WorkerTaskSummarySchema,
  }),
});

/**
 * Run a task.
 *
 * Long-running and no payload beyond the task id: the outcome of a run is the
 * task's own state, which the client already watches, so the response reports
 * where the task ended up rather than a second description of the run.
 */
export const WorkerTaskRunRequestSchema = z.object({
  type: z.literal("worker.task.run.request"),
  requestId: z.string(),
  taskId: z.string().min(1),
});

export const WorkerTaskRunResponseSchema = z.object({
  type: z.literal("worker.task.run.response"),
  payload: z.object({
    requestId: z.string(),
    task: WorkerTaskSummarySchema,
  }),
});

export const WorkerTaskHistoryRequestSchema = z.object({
  type: z.literal("worker.task.history.request"),
  requestId: z.string(),
  taskId: z.string().min(1),
});

/**
 * Every task across every worker, optionally narrowed to one worker.
 *
 * The dashboard needs totals across workers, and the task table needs rows from
 * more than one; fetching them one worker at a time would make the screen's
 * cost track the roster size.
 */
export const WorkerTaskListRequestSchema = z.object({
  type: z.literal("worker.task.list.request"),
  requestId: z.string(),
  workerId: z.string().min(1).optional(),
});

export const WorkerTaskListResponseSchema = z.object({
  type: z.literal("worker.task.list.response"),
  payload: z.object({
    requestId: z.string(),
    tasks: z.array(WorkerTaskSummarySchema),
  }),
});

export const WorkerTaskHistoryResponseSchema = z.object({
  type: z.literal("worker.task.history.response"),
  payload: z.object({
    requestId: z.string(),
    taskId: z.string(),
    entries: z.array(WorkerTaskHistoryEntrySchema),
  }),
});

// ----------------------------------------------------------------- guard

/**
 * Dry-run a shell command against the guard without running it.
 *
 * Exposed because the alternative — letting the user find out by running it —
 * is exactly the outcome the guard exists to prevent.
 */
export const WorkerGuardEvaluateRequestSchema = z.object({
  type: z.literal("worker.guard.evaluate.request"),
  requestId: z.string(),
  command: z.string(),
  toolName: z.string().optional(),
});

export const WorkerGuardEvaluateResponseSchema = z.object({
  type: z.literal("worker.guard.evaluate.response"),
  payload: z.object({
    requestId: z.string(),
    decision: GuardDecisionSchema,
    maxSeverity: GuardSeveritySchema.nullable(),
    findings: z.array(GuardFindingSchema),
  }),
});

// ------------------------------------------------------------------ groups

/** What a member contributes. Exactly one member per group is its coordinator. */
export const WorkerGroupMemberRoleSchema = z.enum(["coordinator", "member"]);

export const WorkerGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The daemon's project id. A group outlives a moved checkout. */
  projectId: z.string(),
  /** Null until a workspace is chosen; the roster exists before one does. */
  workspaceId: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  members: z.array(
    z.object({
      workerId: z.string(),
      role: WorkerGroupMemberRoleSchema,
      joinedAt: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkerGroupListRequestSchema = z.object({
  type: z.literal("worker.group.list.request"),
  requestId: z.string(),
});

export const WorkerGroupListResponseSchema = z.object({
  type: z.literal("worker.group.list.response"),
  payload: z.object({
    requestId: z.string(),
    groups: z.array(WorkerGroupSummarySchema),
  }),
});

/**
 * Create a group on a project, optionally with its roster in the same call.
 *
 * The roster is part of creation rather than a follow-up so a coordinator can
 * stand up a team in one step, and so a rejected roster cannot leave a
 * half-made group behind.
 */
export const WorkerGroupCreateRequestSchema = z.object({
  type: z.literal("worker.group.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1).nullable().optional(),
  /** The worker that owns the goal; it is added to the roster as coordinator. */
  coordinatorWorkerId: z.string().min(1).optional(),
  memberWorkerIds: z.array(z.string().min(1)).optional(),
});

export const WorkerGroupCreateResponseSchema = z.object({
  type: z.literal("worker.group.create.response"),
  payload: z.object({
    requestId: z.string(),
    group: WorkerGroupSummarySchema,
  }),
});

export const WorkerGroupAddMemberRequestSchema = z.object({
  type: z.literal("worker.group.add_member.request"),
  requestId: z.string(),
  groupId: z.string().min(1),
  workerId: z.string().min(1),
  role: WorkerGroupMemberRoleSchema,
});

export const WorkerGroupAddMemberResponseSchema = z.object({
  type: z.literal("worker.group.add_member.response"),
  payload: z.object({
    requestId: z.string(),
    group: WorkerGroupSummarySchema,
  }),
});

export const WorkerGroupRemoveMemberRequestSchema = z.object({
  type: z.literal("worker.group.remove_member.request"),
  requestId: z.string(),
  groupId: z.string().min(1),
  workerId: z.string().min(1),
});

export const WorkerGroupRemoveMemberResponseSchema = z.object({
  type: z.literal("worker.group.remove_member.response"),
  payload: z.object({
    requestId: z.string(),
    group: WorkerGroupSummarySchema,
  }),
});

// ----------------------------------------------------------------- messages

/**
 * Whether a message wakes its audience.
 *
 * Deliberately separate from who can read it: the reference product models
 * waking and visibility as different questions, so a message can be visible to
 * the whole group while waking nobody.
 */
export const WorkerMessageDeliveryPolicySchema = z.enum(["wake", "store_only"]);

/** Display classification. It does not change routing. */
export const WorkerMessageIntentSchema = z.enum(["chat", "ask", "notify", "request_action"]);

export const WorkerMessageDeliveryStateSchema = z.enum(["unread", "claimed", "read"]);

export const WorkerMessageSummarySchema = z.object({
  messageId: z.string(),
  groupId: z.string(),
  /** Visible ordering within the group. */
  seq: z.number(),
  senderWorkerId: z.string(),
  body: z.string(),
  intent: WorkerMessageIntentSchema,
  deliveryPolicy: WorkerMessageDeliveryPolicySchema,
  replyToMessageId: z.string().nullable(),
  /** Addressed workers. Empty when nobody is addressed. */
  audience: z.array(z.string()),
  /** Workers allowed to read it when narrower than the group; empty means public. */
  privateTo: z.array(z.string()),
  createdAt: z.string(),
});

export const WorkerMessageSendRequestSchema = z.object({
  type: z.literal("worker.message.send.request"),
  requestId: z.string(),
  groupId: z.string().min(1),
  /**
   * Who is sending.
   *
   * Optional because a worker does not know this about itself: it knows its
   * agent session, and `senderSessionId` resolves the worker from that. A caller
   * that is not a worker (the console) supplies the id directly.
   */
  senderWorkerId: z.string().min(1).optional(),
  /**
   * The agent session of a worker sending from inside a run or task.
   *
   * Preferred over `senderWorkerId` when present, because the daemon can check
   * it: an in-flight run or in-progress task owns that session. A worker that
   * names a different worker alongside it is refused rather than overruled, so a
   * mistake shows up instead of being silently corrected.
   */
  senderSessionId: z.string().min(1).optional(),
  body: z.string().min(1),
  intent: WorkerMessageIntentSchema.optional(),
  deliveryPolicy: WorkerMessageDeliveryPolicySchema.optional(),
  replyToMessageId: z.string().optional(),
  audience: z.array(z.string()).optional(),
  privateTo: z.array(z.string()).optional(),
});

export const WorkerMessageSendResponseSchema = z.object({
  type: z.literal("worker.message.send.response"),
  payload: z.object({
    requestId: z.string(),
    message: WorkerMessageSummarySchema,
    /**
     * Workers this message woke. Empty for a store-only send, and empty for a
     * waking send that addressed nobody — which is why it is reported rather
     * than inferred from the message.
     */
    woke: z.array(z.string()),
  }),
});

export const WorkerMessageListRequestSchema = z.object({
  type: z.literal("worker.message.list.request"),
  requestId: z.string(),
  groupId: z.string().min(1),
  /**
   * Filters to what this worker may read. Omit for the operator view. A worker
   * asking for its own stream must pass its own id, or it would see messages
   * it is not a reader of.
   */
  viewerWorkerId: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

export const WorkerMessageListResponseSchema = z.object({
  type: z.literal("worker.message.list.response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(WorkerMessageSummarySchema),
  }),
});

export const WorkerInboxListRequestSchema = z.object({
  type: z.literal("worker.inbox.list.request"),
  requestId: z.string(),
  workerId: z.string().min(1),
});

export const WorkerInboxListResponseSchema = z.object({
  type: z.literal("worker.inbox.list.response"),
  payload: z.object({
    requestId: z.string(),
    /** Delivery state is per reader, so it travels with the message. */
    entries: z.array(
      z.object({
        message: WorkerMessageSummarySchema,
        state: WorkerMessageDeliveryStateSchema,
      }),
    ),
  }),
});

export const WorkerMessageDeliveryMarkRequestSchema = z.object({
  type: z.literal("worker.message.delivery.request"),
  requestId: z.string(),
  messageId: z.string().min(1),
  workerId: z.string().min(1),
  state: WorkerMessageDeliveryStateSchema,
});

export const WorkerMessageDeliveryMarkResponseSchema = z.object({
  type: z.literal("worker.message.delivery.response"),
  payload: z.object({
    requestId: z.string(),
    /**
     * False when the worker has no delivery for this message, which means it was
     * not addressed by it. A normal answer, not an error.
     */
    marked: z.boolean(),
  }),
});

// -------------------------------------------------------------------- goals

export const WorkerGoalStatusSchema = z.enum(["active", "completed", "paused"]);

/** Why automatic work stopped. Each calls for a different response. */
export const WorkerGoalPauseReasonSchema = z.enum([
  "user_stop",
  "awaiting_user",
  "turn_limit",
  "no_progress",
  "execution_error",
  "leader_unavailable",
]);

/**
 * The group's objective.
 *
 * `turnUsed` and `turnLimit` travel with it so a caller can see how much budget
 * is left without a second request, and `generation`/`revision` are what a
 * mutation must echo back.
 */
export const WorkerGoalSummarySchema = z.object({
  goalId: z.string(),
  groupId: z.string(),
  content: z.string(),
  turnLimit: z.number(),
  /** Public messages spent against the current generation. */
  turnUsed: z.number(),
  status: WorkerGoalStatusSchema,
  generation: z.number(),
  revision: z.number(),
  pauseReason: WorkerGoalPauseReasonSchema.nullable(),
  /** The message that delivered the result, once the goal is completed. */
  resultMessageId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkerGoalGetRequestSchema = z.object({
  type: z.literal("worker.goal.get.request"),
  requestId: z.string(),
  groupId: z.string().min(1),
});

export const WorkerGoalGetResponseSchema = z.object({
  type: z.literal("worker.goal.get.response"),
  payload: z.object({
    requestId: z.string(),
    /** Null when the group has no goal yet; a group may exist before one is set. */
    goal: WorkerGoalSummarySchema.nullable(),
  }),
});

export const WorkerGoalCreateRequestSchema = z.object({
  type: z.literal("worker.goal.create.request"),
  requestId: z.string(),
  groupId: z.string().min(1),
  content: z.string().min(1),
  turnLimit: z.number().int().positive(),
});

export const WorkerGoalCreateResponseSchema = z.object({
  type: z.literal("worker.goal.create.response"),
  payload: z.object({
    requestId: z.string(),
    goal: WorkerGoalSummarySchema,
  }),
});

export const WorkerGoalMutateRequestSchema = z.object({
  type: z.literal("worker.goal.mutate.request"),
  requestId: z.string(),
  groupId: z.string().min(1),
  action: z.enum(["update", "complete", "pause", "reopen"]),
  /**
   * What the caller read. A mutation against a stale pair is refused, so a
   * second writer cannot silently overwrite the first.
   */
  expectedGeneration: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  content: z.string().min(1).optional(),
  turnLimit: z.number().int().positive().optional(),
  pauseReason: WorkerGoalPauseReasonSchema.optional(),
  resultMessageId: z.string().min(1).optional(),
});

export const WorkerGoalMutateResponseSchema = z.object({
  type: z.literal("worker.goal.mutate.response"),
  payload: z.object({
    requestId: z.string(),
    goal: WorkerGoalSummarySchema,
  }),
});

// ---------------------------------------------------------------- activity

/**
 * One day of a worker's activity.
 *
 * Days with nothing in them are absent rather than zero: the caller knows what
 * a gap means, and sending every day in a range would make the server choose
 * the range.
 */
export const WorkerActivityDaySchema = z.object({
  day: z.string(),
  count: z.number(),
});

export const WorkerActivityRequestSchema = z.object({
  type: z.literal("worker.activity.request"),
  requestId: z.string(),
  workerId: z.string().min(1),
});

export const WorkerActivityResponseSchema = z.object({
  type: z.literal("worker.activity.response"),
  payload: z.object({
    requestId: z.string(),
    days: z.array(WorkerActivityDaySchema),
  }),
});

// Inferred types, exported on demand rather than all at once: consumers need the
// shapes, not the validators, and an export nobody imports drifts unnoticed.
// `WorkerTaskSummary` is the one the app derives its task-state union from.
export type WorkerTemplateSummary = z.infer<typeof WorkerTemplateSummarySchema>;
export type WorkerTaskSummary = z.infer<typeof WorkerTaskSummarySchema>;
export type WorkerGroupSummary = z.infer<typeof WorkerGroupSummarySchema>;
export type WorkerMessageSummary = z.infer<typeof WorkerMessageSummarySchema>;
export type WorkerMessageDeliveryPolicy = z.infer<typeof WorkerMessageDeliveryPolicySchema>;
export type WorkerMessageIntent = z.infer<typeof WorkerMessageIntentSchema>;
export type WorkerGoalSummary = z.infer<typeof WorkerGoalSummarySchema>;
export type WorkerGoalPauseReason = z.infer<typeof WorkerGoalPauseReasonSchema>;
export type WorkerActivityDay = z.infer<typeof WorkerActivityDaySchema>;
