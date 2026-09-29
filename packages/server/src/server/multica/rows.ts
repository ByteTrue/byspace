/**
 * Row types and mapping for the multica-replica issue table.
 *
 * Rows are what the store returns; the JSON-typed columns (metadata,
 * properties) stay as their TEXT wire form so the reader parses with its own
 * schema — validation belongs to the reader, per the translation rules.
 */
export interface IssueRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: string;
  readonly assigneeType: string | null;
  readonly assigneeId: string | null;
  readonly creatorType: string;
  readonly creatorId: string;
  readonly parentIssueId: string | null;
  readonly acceptanceCriteria: string;
  readonly contextRefs: string;
  readonly position: number;
  readonly dueDate: string | null;
  readonly number: number | null;
  readonly projectId: string | null;
  readonly originType: string | null;
  readonly originId: string | null;
  readonly firstExecutedAt: string | null;
  readonly stage: number | null;
  readonly startDate: string | null;
  readonly metadata: string;
  readonly properties: string;
  readonly revision: number;
  readonly lastActivityAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly triageState: string | null;
  readonly duplicateOfIssueId: string | null;
}

/** The issue columns in SELECT order — the single source of truth for both. */
export const ISSUE_SELECT = `id, title, description, status, priority, assignee_type, assignee_id,
  creator_type, creator_id, parent_issue_id, acceptance_criteria, context_refs, position,
  due_date, number, project_id, origin_type, origin_id, first_executed_at, stage, start_date,
  metadata, properties, revision, last_activity_at, created_at, updated_at, triage_state,
  duplicate_of_issue_id`;

/** The comment columns in SELECT order — the single source of truth. */
export const COMMENT_SELECT = `id, issue_id, author_type, author_id, content, type, parent_id,
  resolved_at, resolved_by_type, resolved_by_id, created_at, updated_at, source_task_id,
  quick_action_id, via_plugin_id, revision, recovery_settled_at, deleted_at, suppressed_agent_ids`;

export interface CommentRow {
  readonly id: string;
  readonly issueId: string;
  readonly authorType: string;
  readonly authorId: string;
  readonly content: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedByType: string | null;
  readonly resolvedById: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceTaskId: string | null;
  readonly quickActionId: string | null;
  readonly viaPluginId: string | null;
  readonly revision: number;
  readonly recoverySettledAt: string | null;
  readonly deletedAt: string | null;
  readonly suppressedAgentIds: string | null;
}

interface RawCommentRow {
  readonly id: unknown;
  readonly issue_id: unknown;
  readonly author_type: unknown;
  readonly author_id: unknown;
  readonly content: unknown;
  readonly type: unknown;
  readonly parent_id: unknown;
  readonly resolved_at: unknown;
  readonly resolved_by_type: unknown;
  readonly resolved_by_id: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly source_task_id: unknown;
  readonly quick_action_id: unknown;
  readonly via_plugin_id: unknown;
  readonly revision: unknown;
  readonly recovery_settled_at: unknown;
  readonly deleted_at: unknown;
  readonly suppressed_agent_ids: unknown;
}

export function mapCommentRow(raw: RawCommentRow): CommentRow {
  return {
    id: text(raw.id),
    issueId: text(raw.issue_id),
    authorType: text(raw.author_type),
    authorId: text(raw.author_id),
    content: text(raw.content),
    type: text(raw.type),
    parentId: textOrNull(raw.parent_id),
    resolvedAt: textOrNull(raw.resolved_at),
    resolvedByType: textOrNull(raw.resolved_by_type),
    resolvedById: textOrNull(raw.resolved_by_id),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    sourceTaskId: textOrNull(raw.source_task_id),
    quickActionId: textOrNull(raw.quick_action_id),
    viaPluginId: textOrNull(raw.via_plugin_id),
    revision: Number(raw.revision),
    recoverySettledAt: textOrNull(raw.recovery_settled_at),
    deletedAt: textOrNull(raw.deleted_at),
    suppressedAgentIds: textOrNull(raw.suppressed_agent_ids),
  };
}

/** The agent columns in SELECT order — the single source of truth. */
export const AGENT_SELECT = `id, name, avatar_url, runtime_mode, runtime_config, visibility, status,
  max_concurrent_tasks, description, instructions, archived_at, archived_by, custom_env, custom_args,
  mcp_config, model, created_at, updated_at, runtime_id, thinking_level,
  composio_toolkit_allowlist, permission_mode, kind, system_key, disabled_runtime_skills,
  service_tier, conversation_starters`;

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly runtimeMode: string;
  readonly runtimeConfig: string;
  readonly visibility: string;
  readonly status: string;
  readonly maxConcurrentTasks: number;
  readonly description: string;
  readonly instructions: string;
  readonly archivedAt: string | null;
  readonly archivedBy: string | null;
  readonly customEnv: string | null;
  readonly customArgs: string;
  readonly mcpConfig: string | null;
  readonly model: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runtimeId: string | null;
  readonly thinkingLevel: string | null;
  readonly composioToolkitAllowlist: string | null;
  readonly permissionMode: string;
  readonly kind: string;
  readonly systemKey: string | null;
  readonly disabledRuntimeSkills: string;
  readonly serviceTier: string | null;
  readonly conversationStarters: string;
}

interface RawAgentRow {
  readonly id: unknown;
  readonly name: unknown;
  readonly avatar_url: unknown;
  readonly runtime_mode: unknown;
  readonly runtime_config: unknown;
  readonly visibility: unknown;
  readonly status: unknown;
  readonly max_concurrent_tasks: unknown;
  readonly description: unknown;
  readonly instructions: unknown;
  readonly archived_at: unknown;
  readonly archived_by: unknown;
  readonly custom_env: unknown;
  readonly custom_args: unknown;
  readonly mcp_config: unknown;
  readonly model: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly runtime_id: unknown;
  readonly thinking_level: unknown;
  readonly composio_toolkit_allowlist: unknown;
  readonly permission_mode: unknown;
  readonly kind: unknown;
  readonly system_key: unknown;
  readonly disabled_runtime_skills: unknown;
  readonly service_tier: unknown;
  readonly conversation_starters: unknown;
}

export function mapAgentRow(raw: RawAgentRow): AgentRow {
  return {
    id: text(raw.id),
    name: text(raw.name),
    avatarUrl: textOrNull(raw.avatar_url),
    runtimeMode: text(raw.runtime_mode),
    runtimeConfig: text(raw.runtime_config),
    visibility: text(raw.visibility),
    status: text(raw.status),
    maxConcurrentTasks: Number(raw.max_concurrent_tasks),
    description: text(raw.description),
    instructions: text(raw.instructions),
    archivedAt: textOrNull(raw.archived_at),
    archivedBy: textOrNull(raw.archived_by),
    customEnv: textOrNull(raw.custom_env),
    customArgs: text(raw.custom_args),
    mcpConfig: textOrNull(raw.mcp_config),
    model: textOrNull(raw.model),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    runtimeId: textOrNull(raw.runtime_id),
    thinkingLevel: textOrNull(raw.thinking_level),
    composioToolkitAllowlist: textOrNull(raw.composio_toolkit_allowlist),
    permissionMode: text(raw.permission_mode),
    kind: text(raw.kind),
    systemKey: textOrNull(raw.system_key),
    disabledRuntimeSkills: text(raw.disabled_runtime_skills),
    serviceTier: textOrNull(raw.service_tier),
    conversationStarters: text(raw.conversation_starters),
  };
}

/** The squad columns in SELECT order. */
export const SQUAD_SELECT = `id, name, description, leader_id, creator_type, creator_id,
  created_at, updated_at, archived_at, archived_by, avatar_url, instructions`;

export interface SquadRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly leaderId: string;
  readonly creatorType: string;
  readonly creatorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly archivedBy: string | null;
  readonly avatarUrl: string | null;
  readonly instructions: string;
}

export interface SquadMemberRow {
  readonly id: string;
  readonly squadId: string;
  readonly memberType: string;
  readonly memberId: string;
  readonly role: string;
  readonly createdAt: string;
}

interface RawSquadRow {
  readonly id: unknown;
  readonly name: unknown;
  readonly description: unknown;
  readonly leader_id: unknown;
  readonly creator_type: unknown;
  readonly creator_id: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly archived_at: unknown;
  readonly archived_by: unknown;
  readonly avatar_url: unknown;
  readonly instructions: unknown;
}

export function mapSquadRow(raw: RawSquadRow): SquadRow {
  return {
    id: text(raw.id),
    name: text(raw.name),
    description: text(raw.description),
    leaderId: text(raw.leader_id),
    creatorType: text(raw.creator_type),
    creatorId: text(raw.creator_id),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    archivedAt: textOrNull(raw.archived_at),
    archivedBy: textOrNull(raw.archived_by),
    avatarUrl: textOrNull(raw.avatar_url),
    instructions: text(raw.instructions),
  };
}

interface RawSquadMemberRow {
  readonly id: unknown;
  readonly squad_id: unknown;
  readonly member_type: unknown;
  readonly member_id: unknown;
  readonly role: unknown;
  readonly created_at: unknown;
}

export function mapSquadMemberRow(raw: RawSquadMemberRow): SquadMemberRow {
  return {
    id: text(raw.id),
    squadId: text(raw.squad_id),
    memberType: text(raw.member_type),
    memberId: text(raw.member_id),
    role: text(raw.role),
    createdAt: text(raw.created_at),
  };
}

/** The queue (run) columns in SELECT order. */
export const TASK_SELECT = `id, agent_id, issue_id, status, priority, dispatched_at, started_at,
  completed_at, result, error, autopilot_run_id, attempt, max_attempts, parent_task_id,
  failure_reason, trigger_summary, force_fresh_session, context, session_id, work_dir,
  trigger_comment_id, chat_session_id, wait_reason, initiator_user_id, runtime_mcp_overlay,
  runtime_connected_apps, chat_input_task_id, chat_finalize_deferred_at, runtime_id, handoff_note,
  prepare_lease_expires_at, escalation_for_task_id, fire_at, is_leader_task, squad_id,
  originator_user_id, originator_source, delegated_from_task_id, retry_of_task_id, rerun_of_task_id,
  rule_version_id, trigger_evidence_kind, trigger_evidence_ref_id, accountable_user_id,
  coalesced_comment_ids, delivered_comment_ids, created_at, session_rollout_missing,
  retired_session_id, quick_actions_disabled, regenerate_quick_actions_for, branch_name,
  durable_work_dir, channel_context_revision, comment_thread_id, cancelled_by_type,
  cancelled_by_id, cancelled_by_name, issue_snapshot`;

export interface TaskRow {
  readonly id: string;
  readonly agentId: string;
  readonly issueId: string | null;
  readonly status: string;
  readonly priority: number;
  readonly dispatchedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly autopilotRunId: string | null;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly parentTaskId: string | null;
  readonly failureReason: string | null;
  readonly triggerSummary: string | null;
  readonly forceFreshSession: boolean;
  readonly context: string | null;
  readonly sessionId: string | null;
  readonly workDir: string | null;
  readonly triggerCommentId: string | null;
  readonly chatSessionId: string | null;
  readonly waitReason: string | null;
  readonly initiatorUserId: string | null;
  readonly runtimeMcpOverlay: string | null;
  readonly runtimeConnectedApps: string | null;
  readonly chatInputTaskId: string | null;
  readonly chatFinalizeDeferredAt: string | null;
  readonly runtimeId: string | null;
  readonly handoffNote: string | null;
  readonly prepareLeaseExpiresAt: string | null;
  readonly escalationForTaskId: string | null;
  readonly fireAt: string | null;
  readonly isLeaderTask: boolean;
  readonly squadId: string | null;
  readonly originatorUserId: string | null;
  readonly originatorSource: string | null;
  readonly delegatedFromTaskId: string | null;
  readonly retryOfTaskId: string | null;
  readonly rerunOfTaskId: string | null;
  readonly ruleVersionId: string | null;
  readonly triggerEvidenceKind: string | null;
  readonly triggerEvidenceRefId: string | null;
  readonly accountableUserId: string | null;
  readonly coalescedCommentIds: string;
  readonly deliveredCommentIds: string;
  readonly createdAt: string;
  readonly sessionRolloutMissing: boolean;
  readonly retiredSessionId: string | null;
  readonly quickActionsDisabled: boolean;
  readonly regenerateQuickActionsFor: string | null;
  readonly branchName: string | null;
  readonly durableWorkDir: string | null;
  readonly channelContextRevision: string | null;
  readonly commentThreadId: string | null;
  readonly cancelledByType: string | null;
  readonly cancelledById: string | null;
  readonly cancelledByName: string | null;
  readonly issueSnapshot: string | null;
}

interface RawTaskRow {
  readonly [key: string]: unknown;
}

const bool = (value: unknown): boolean => value === 1 || value === true;

export function mapTaskRow(raw: RawTaskRow): TaskRow {
  return {
    id: text(raw.id),
    agentId: text(raw.agent_id),
    issueId: textOrNull(raw.issue_id),
    status: text(raw.status),
    priority: Number(raw.priority),
    dispatchedAt: textOrNull(raw.dispatched_at),
    startedAt: textOrNull(raw.started_at),
    completedAt: textOrNull(raw.completed_at),
    result: textOrNull(raw.result),
    error: textOrNull(raw.error),
    autopilotRunId: textOrNull(raw.autopilot_run_id),
    attempt: Number(raw.attempt),
    maxAttempts: Number(raw.max_attempts),
    parentTaskId: textOrNull(raw.parent_task_id),
    failureReason: textOrNull(raw.failure_reason),
    triggerSummary: textOrNull(raw.trigger_summary),
    forceFreshSession: bool(raw.force_fresh_session),
    context: textOrNull(raw.context),
    sessionId: textOrNull(raw.session_id),
    workDir: textOrNull(raw.work_dir),
    triggerCommentId: textOrNull(raw.trigger_comment_id),
    chatSessionId: textOrNull(raw.chat_session_id),
    waitReason: textOrNull(raw.wait_reason),
    initiatorUserId: textOrNull(raw.initiator_user_id),
    runtimeMcpOverlay: textOrNull(raw.runtime_mcp_overlay),
    runtimeConnectedApps: textOrNull(raw.runtime_connected_apps),
    chatInputTaskId: textOrNull(raw.chat_input_task_id),
    chatFinalizeDeferredAt: textOrNull(raw.chat_finalize_deferred_at),
    runtimeId: textOrNull(raw.runtime_id),
    handoffNote: textOrNull(raw.handoff_note),
    prepareLeaseExpiresAt: textOrNull(raw.prepare_lease_expires_at),
    escalationForTaskId: textOrNull(raw.escalation_for_task_id),
    fireAt: textOrNull(raw.fire_at),
    isLeaderTask: bool(raw.is_leader_task),
    squadId: textOrNull(raw.squad_id),
    originatorUserId: textOrNull(raw.originator_user_id),
    originatorSource: textOrNull(raw.originator_source),
    delegatedFromTaskId: textOrNull(raw.delegated_from_task_id),
    retryOfTaskId: textOrNull(raw.retry_of_task_id),
    rerunOfTaskId: textOrNull(raw.rerun_of_task_id),
    ruleVersionId: textOrNull(raw.rule_version_id),
    triggerEvidenceKind: textOrNull(raw.trigger_evidence_kind),
    triggerEvidenceRefId: textOrNull(raw.trigger_evidence_ref_id),
    accountableUserId: textOrNull(raw.accountable_user_id),
    coalescedCommentIds: text(raw.coalesced_comment_ids),
    deliveredCommentIds: text(raw.delivered_comment_ids),
    createdAt: text(raw.created_at),
    sessionRolloutMissing: bool(raw.session_rollout_missing),
    retiredSessionId: textOrNull(raw.retired_session_id),
    quickActionsDisabled: bool(raw.quick_actions_disabled),
    regenerateQuickActionsFor: textOrNull(raw.regenerate_quick_actions_for),
    branchName: textOrNull(raw.branch_name),
    durableWorkDir: textOrNull(raw.durable_work_dir),
    channelContextRevision: textOrNull(raw.channel_context_revision),
    commentThreadId: textOrNull(raw.comment_thread_id),
    cancelledByType: textOrNull(raw.cancelled_by_type),
    cancelledById: textOrNull(raw.cancelled_by_id),
    cancelledByName: textOrNull(raw.cancelled_by_name),
    issueSnapshot: textOrNull(raw.issue_snapshot),
  };
}

interface RawIssueRow {
  readonly id: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly status: unknown;
  readonly priority: unknown;
  readonly assignee_type: unknown;
  readonly assignee_id: unknown;
  readonly creator_type: unknown;
  readonly creator_id: unknown;
  readonly parent_issue_id: unknown;
  readonly acceptance_criteria: unknown;
  readonly context_refs: unknown;
  readonly position: unknown;
  readonly due_date: unknown;
  readonly number: unknown;
  readonly project_id: unknown;
  readonly origin_type: unknown;
  readonly origin_id: unknown;
  readonly first_executed_at: unknown;
  readonly stage: unknown;
  readonly start_date: unknown;
  readonly metadata: unknown;
  readonly properties: unknown;
  readonly revision: unknown;
  readonly last_activity_at: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly triage_state: unknown;
  readonly duplicate_of_issue_id: unknown;
}

const text = (value: unknown): string => String(value);
const textOrNull = (value: unknown): string | null => (value === null ? null : String(value));

export function mapIssueRow(raw: RawIssueRow): IssueRow {
  return {
    id: text(raw.id),
    title: text(raw.title),
    description: textOrNull(raw.description),
    status: text(raw.status),
    priority: text(raw.priority),
    assigneeType: textOrNull(raw.assignee_type),
    assigneeId: textOrNull(raw.assignee_id),
    creatorType: text(raw.creator_type),
    creatorId: text(raw.creator_id),
    parentIssueId: textOrNull(raw.parent_issue_id),
    acceptanceCriteria: text(raw.acceptance_criteria),
    contextRefs: text(raw.context_refs),
    position: Number(raw.position),
    dueDate: textOrNull(raw.due_date),
    number: raw.number === null ? null : Number(raw.number),
    projectId: textOrNull(raw.project_id),
    originType: textOrNull(raw.origin_type),
    originId: textOrNull(raw.origin_id),
    firstExecutedAt: textOrNull(raw.first_executed_at),
    stage: raw.stage === null ? null : Number(raw.stage),
    startDate: textOrNull(raw.start_date),
    metadata: text(raw.metadata),
    properties: text(raw.properties),
    revision: Number(raw.revision),
    lastActivityAt: textOrNull(raw.last_activity_at),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    triageState: textOrNull(raw.triage_state),
    duplicateOfIssueId: textOrNull(raw.duplicate_of_issue_id),
  };
}

export const INBOX_SELECT = `id, recipient_type, recipient_id, type, severity, issue_id,
  title, body, read, archived, created_at, actor_type, actor_id, details`;

export type InboxSeverity = "action_required" | "attention" | "info";

export interface InboxRow {
  readonly id: string;
  readonly recipientType: string;
  readonly recipientId: string;
  readonly type: string;
  readonly severity: InboxSeverity;
  readonly issueId: string | null;
  readonly title: string;
  readonly body: string | null;
  readonly read: boolean;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly actorType: string | null;
  readonly actorId: string | null;
  readonly details: Record<string, unknown>;
}

export function mapInboxRow(raw: Record<string, unknown>): InboxRow {
  return {
    id: raw.id as string,
    recipientType: raw.recipient_type as string,
    recipientId: raw.recipient_id as string,
    type: raw.type as string,
    severity: raw.severity as InboxSeverity,
    issueId: (raw.issue_id as string | null) ?? null,
    title: raw.title as string,
    body: (raw.body as string | null) ?? null,
    read: (raw.read as number) === 1,
    archived: (raw.archived as number) === 1,
    createdAt: raw.created_at as string,
    actorType: (raw.actor_type as string | null) ?? null,
    actorId: (raw.actor_id as string | null) ?? null,
    details: JSON.parse((raw.details as string) || "{}") as Record<string, unknown>,
  };
}

// ── autopilot ──────────────────────────────────────────────────────────

export const AUTOPILOT_SELECT = `id, title, description, assignee_type, assignee_id,
  status, execution_mode, issue_title_template, concurrency_policy, created_by_type,
  created_by_id, last_run_at, created_at, updated_at, pause_reason`;

export const AUTOPILOT_TRIGGER_SELECT = `id, autopilot_id, kind, enabled, cron_expression,
  timezone, next_run_at, webhook_token, label, last_fired_at, created_at, updated_at`;

export const AUTOPILOT_RUN_SELECT = `id, autopilot_id, trigger_id, source, status, issue_id,
  task_id, triggered_at, completed_at, failure_reason, trigger_payload, result, created_at,
  planned_at`;

export type AutopilotExecutionMode = "create_issue" | "run_only";
export type AutopilotConcurrencyPolicy = "skip" | "queue" | "replace";
export type AutopilotRunStatus = "issue_created" | "running" | "completed" | "failed" | "skipped";

export interface AutopilotRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly assigneeType: "agent" | "squad";
  readonly assigneeId: string;
  readonly status: "active" | "paused" | "archived";
  readonly executionMode: AutopilotExecutionMode;
  readonly issueTitleTemplate: string | null;
  readonly concurrencyPolicy: AutopilotConcurrencyPolicy;
  readonly createdByType: string;
  readonly createdById: string;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pauseReason: string | null;
}

export interface AutopilotTriggerRow {
  readonly id: string;
  readonly autopilotId: string;
  readonly kind: "schedule" | "webhook" | "api";
  readonly enabled: boolean;
  readonly cronExpression: string | null;
  readonly timezone: string;
  readonly nextRunAt: string | null;
  readonly webhookToken: string | null;
  readonly label: string | null;
  readonly lastFiredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutopilotRunRow {
  readonly id: string;
  readonly autopilotId: string;
  readonly triggerId: string | null;
  readonly source: "schedule" | "manual" | "webhook" | "api";
  readonly status: AutopilotRunStatus;
  readonly issueId: string | null;
  readonly taskId: string | null;
  readonly triggeredAt: string;
  readonly completedAt: string | null;
  readonly failureReason: string | null;
  readonly triggerPayload: string | null;
  readonly result: string | null;
  readonly createdAt: string;
  readonly plannedAt: string | null;
}

export interface ActivityRow {
  readonly id: string;
  readonly issueId: string | null;
  readonly actorType: "owner" | "agent" | "system";
  readonly actorId: string | null;
  readonly action: string;
  readonly details: string;
  readonly createdAt: string;
}

export const ACTIVITY_SELECT = `id, issue_id, actor_type, actor_id, action, details, created_at`;

export function mapActivityRow(raw: Record<string, unknown>): ActivityRow {
  return {
    id: raw.id as string,
    issueId: (raw.issue_id as string | null) ?? null,
    actorType: raw.actor_type as ActivityRow["actorType"],
    actorId: (raw.actor_id as string | null) ?? null,
    action: raw.action as string,
    details: raw.details as string,
    createdAt: raw.created_at as string,
  };
}

export interface LabelRow {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export function mapLabelRow(raw: Record<string, unknown>): LabelRow {
  return {
    id: raw.id as string,
    name: raw.name as string,
    color: raw.color as string,
  };
}

export function mapAutopilotRow(raw: Record<string, unknown>): AutopilotRow {
  return {
    id: raw.id as string,
    title: raw.title as string,
    description: (raw.description as string | null) ?? null,
    assigneeType: raw.assignee_type as "agent" | "squad",
    assigneeId: raw.assignee_id as string,
    status: raw.status as AutopilotRow["status"],
    executionMode: raw.execution_mode as AutopilotExecutionMode,
    issueTitleTemplate: (raw.issue_title_template as string | null) ?? null,
    concurrencyPolicy: raw.concurrency_policy as AutopilotConcurrencyPolicy,
    createdByType: raw.created_by_type as string,
    createdById: raw.created_by_id as string,
    lastRunAt: (raw.last_run_at as string | null) ?? null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
    pauseReason: (raw.pause_reason as string | null) ?? null,
  };
}

export function mapAutopilotTriggerRow(raw: Record<string, unknown>): AutopilotTriggerRow {
  return {
    id: raw.id as string,
    autopilotId: raw.autopilot_id as string,
    kind: raw.kind as AutopilotTriggerRow["kind"],
    enabled: (raw.enabled as number) === 1,
    cronExpression: (raw.cron_expression as string | null) ?? null,
    timezone: (raw.timezone as string | null) ?? "UTC",
    nextRunAt: (raw.next_run_at as string | null) ?? null,
    webhookToken: (raw.webhook_token as string | null) ?? null,
    label: (raw.label as string | null) ?? null,
    lastFiredAt: (raw.last_fired_at as string | null) ?? null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

export function mapAutopilotRunRow(raw: Record<string, unknown>): AutopilotRunRow {
  return {
    id: raw.id as string,
    autopilotId: raw.autopilot_id as string,
    triggerId: (raw.trigger_id as string | null) ?? null,
    source: raw.source as AutopilotRunRow["source"],
    status: raw.status as AutopilotRunStatus,
    issueId: (raw.issue_id as string | null) ?? null,
    taskId: (raw.task_id as string | null) ?? null,
    triggeredAt: raw.triggered_at as string,
    completedAt: (raw.completed_at as string | null) ?? null,
    failureReason: (raw.failure_reason as string | null) ?? null,
    triggerPayload: (raw.trigger_payload as string | null) ?? null,
    result: (raw.result as string | null) ?? null,
    createdAt: raw.created_at as string,
    plannedAt: (raw.planned_at as string | null) ?? null,
  };
}

/**
 * The one placeholder the source supports in an issue title template
 * (`SupportedIssueTitleTemplateVariables`): {{date}}, in the trigger's
 * timezone. Whitespace inside the braces is tolerated, as the source does.
 */
export function interpolateIssueTitle(template: string, now: Date, timezone: string): string {
  return template.replace(/\{\{\s*date\s*\}\}/g, formatDateInZone(now, timezone));
}

function formatDateInZone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
