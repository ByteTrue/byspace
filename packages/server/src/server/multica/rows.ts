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
