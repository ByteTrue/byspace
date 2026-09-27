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
  readonly customEnv: string;
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
    customEnv: text(raw.custom_env),
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
