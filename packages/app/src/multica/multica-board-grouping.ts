/**
 * The board's second axis. Columns are either the status catalog or the
 * assignee roster (plus an Unassigned column); a drop resolves to the field
 * of the axis it landed on plus the position slot, after the source's move
 * semantics — the midpoint of the two neighbours, the column's end beyond
 * the last card, and the column top on an empty column.
 *
 * position always ranks within (workspace, status); a drop on the assignee
 * axis therefore changes the assignee and re-slots inside the issue's own
 * status column in one write, exactly as the source's move endpoint does.
 */
import type { MulticaIssueSummary } from "@bytetrue/protocol/multica/rpc-schemas";

export type BoardGrouping = "status" | "assignee";

export interface BoardColumnSpec {
  /** The droppable id's payload: which axis and which member. */
  readonly id: string;
  readonly title: string;
  readonly color: string;
  readonly statusKey: string | null;
  readonly assigneeId: string | null;
  /** True for the assignee axis's catch-all column. */
  readonly unassigned: boolean;
}

export const UNASSIGNED_COLUMN_ID = "assignee:unassigned";

export function buildColumns(input: {
  grouping: BoardGrouping;
  statuses: readonly { key: string; name: string; color: string }[];
  agents: readonly { id: string; name: string }[];
}): BoardColumnSpec[] {
  if (input.grouping === "status") {
    return input.statuses.map((status) => ({
      id: `status:${status.key}`,
      title: status.name,
      color: status.color,
      statusKey: status.key,
      assigneeId: null,
      unassigned: false,
    }));
  }
  const columns: BoardColumnSpec[] = input.agents.map((agent) => ({
    id: `assignee:${agent.id}`,
    title: agent.name,
    color: "#8b5cf6",
    statusKey: null,
    assigneeId: agent.id,
    unassigned: false,
  }));
  columns.push({
    id: UNASSIGNED_COLUMN_ID,
    title: "Unassigned",
    color: "#9ca3af",
    statusKey: null,
    assigneeId: null,
    unassigned: true,
  });
  return columns;
}

export function issuesForColumn(
  column: BoardColumnSpec,
  issues: readonly MulticaIssueSummary[],
): MulticaIssueSummary[] {
  if (column.statusKey !== null) {
    return issues.filter((issue) => issue.status === column.statusKey);
  }
  if (column.unassigned) {
    return issues.filter((issue) => issue.assigneeId === null);
  }
  return issues.filter((issue) => issue.assigneeId === column.assigneeId);
}

/** What a drop writes: the axis field plus the slot, or null when it is a no-op. */
export interface DropWrite {
  readonly status: string | null;
  readonly assigneeId: string | null;
  readonly clearsAssignee: boolean;
  readonly position: number;
}

export function resolveDrop(input: {
  overId: string;
  draggedId: string;
  grouping: BoardGrouping;
  columns: readonly BoardColumnSpec[];
  issues: readonly MulticaIssueSummary[];
}): DropWrite | null {
  // A drop lands either on a column body (append) or on a card (insert
  // before it). Cards are draggables, so their id doubles as a droppable.
  const overCard = input.issues.find((issue) => issue.id === input.overId);
  const column = overCard
    ? columnOfIssue(overCard, input.columns)
    : (input.columns.find((entry) => entry.id === input.overId) ?? null);
  if (!column) {
    return null;
  }
  const inColumn = issuesForColumn(column, input.issues).filter(
    (issue) => issue.id !== input.draggedId,
  );
  const index = overCard
    ? inColumn.findIndex((issue) => issue.id === overCard.id)
    : inColumn.length;
  const position = slotPosition(inColumn, index === -1 ? inColumn.length : index);
  if (column.statusKey !== null) {
    return { status: column.statusKey, assigneeId: null, clearsAssignee: false, position };
  }
  return {
    status: null,
    assigneeId: column.unassigned ? null : column.assigneeId,
    clearsAssignee: column.unassigned,
    position,
  };
}

function columnOfIssue(
  issue: MulticaIssueSummary,
  columns: readonly BoardColumnSpec[],
): BoardColumnSpec | null {
  return columns.find((column) => columnHolds(column, issue)) ?? null;
}

function columnHolds(column: BoardColumnSpec, issue: MulticaIssueSummary): boolean {
  if (column.statusKey !== null) {
    return column.statusKey === issue.status;
  }
  if (column.unassigned) {
    return issue.assigneeId === null;
  }
  return column.assigneeId === issue.assigneeId;
}

/**
 * The slot at an insertion index, after the source's issueMovePosition:
 * midpoint between the two neighbours, beyond the last card's position plus
 * one, above the first minus one, and the column top on an empty column.
 */
export function slotPosition(column: readonly MulticaIssueSummary[], index: number): number {
  if (column.length === 0) {
    return -1;
  }
  if (index <= 0) {
    return column[0].position - 1;
  }
  if (index >= column.length) {
    return column[column.length - 1].position + 1;
  }
  return (column[index - 1].position + column[index].position) / 2;
}

/** The slot between two known neighbours, for drops onto a card. */
export function slotAtCard(column: readonly MulticaIssueSummary[], cardId: string): number | null {
  const index = column.findIndex((issue) => issue.id === cardId);
  if (index === -1) {
    return null;
  }
  return slotPosition(column, index);
}
