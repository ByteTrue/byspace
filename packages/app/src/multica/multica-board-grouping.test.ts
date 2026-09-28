/**
 * The second axis' pure rules: column derivation per grouping, which issues
 * each column holds, and what a drop writes — including that an assignee-axis
 * drop never touches status.
 */
import { describe, expect, it } from "vitest";

import type { MulticaIssueSummary } from "@bytetrue/protocol/multica/rpc-schemas";

import {
  UNASSIGNED_COLUMN_ID,
  buildColumns,
  issuesForColumn,
  resolveDrop,
  slotAtCard,
  slotPosition,
} from "./multica-board-grouping.js";

const statuses = [
  { key: "backlog", name: "Backlog", color: "#6b7280" },
  { key: "todo", name: "Todo", color: "#6b7280" },
];
const agents = [
  { id: "ag-1", name: "Writer" },
  { id: "ag-2", name: "Editor" },
];

const issue = (over: Partial<MulticaIssueSummary>): MulticaIssueSummary =>
  ({
    id: "i-1",
    title: "t",
    description: null,
    status: "backlog",
    priority: "none",
    assigneeType: null,
    assigneeId: null,
    creatorType: "owner",
    creatorId: "owner",
    number: 1,
    projectId: null,
    revision: 1,
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastActivityAt: null,
    ...over,
  }) as MulticaIssueSummary;

describe("column derivation", () => {
  it("the status axis is the catalog", () => {
    const columns = buildColumns({ grouping: "status", statuses, agents });
    expect(columns.map((column) => column.id)).toEqual(["status:backlog", "status:todo"]);
  });

  it("the assignee axis is the roster plus an Unassigned catch-all", () => {
    const columns = buildColumns({ grouping: "assignee", statuses, agents });
    expect(columns.map((column) => column.id)).toEqual([
      "assignee:ag-1",
      "assignee:ag-2",
      UNASSIGNED_COLUMN_ID,
    ]);
  });

  it("the Unassigned column catches exactly the unassigned", () => {
    const columns = buildColumns({ grouping: "assignee", statuses, agents });
    const unassignedColumn = columns[2];
    const issues = [issue({ id: "a", assigneeId: "ag-1" }), issue({ id: "b", assigneeId: null })];
    expect(issuesForColumn(unassignedColumn, issues).map((entry) => entry.id)).toEqual(["b"]);
    expect(issuesForColumn(columns[0], issues).map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("drop writes", () => {
  const issues = [issue({ id: "a", position: -2 }), issue({ id: "b", position: -1 })];

  it("a status-axis drop writes status and a slot", () => {
    const columns = buildColumns({ grouping: "status", statuses, agents });
    const write = resolveDrop({
      overId: "status:todo",
      draggedId: "a",
      grouping: "status",
      columns,
      issues,
    });
    expect(write).toEqual({
      status: "todo",
      assigneeId: null,
      clearsAssignee: false,
      position: -1, // empty target column: top slot
    });
  });

  it("an assignee-axis drop writes the assignee and never the status", () => {
    const columns = buildColumns({ grouping: "assignee", statuses, agents });
    const write = resolveDrop({
      overId: "assignee:ag-2",
      draggedId: "a",
      grouping: "assignee",
      columns,
      issues,
    });
    expect(write?.status).toBeNull();
    expect(write?.assigneeId).toBe("ag-2");
    expect(write?.clearsAssignee).toBe(false);
  });

  it("the Unassigned column clears the assignee", () => {
    const columns = buildColumns({ grouping: "assignee", statuses, agents });
    const write = resolveDrop({
      overId: UNASSIGNED_COLUMN_ID,
      draggedId: "a",
      grouping: "assignee",
      columns,
      issues: [issue({ id: "a", assigneeId: "ag-1", position: -2 })],
    });
    expect(write?.clearsAssignee).toBe(true);
    expect(write?.assigneeId).toBeNull();
  });

  it("a drop onto the first card takes its slot", () => {
    const columns = buildColumns({ grouping: "status", statuses, agents });
    const write = resolveDrop({
      overId: "b",
      draggedId: "a",
      grouping: "status",
      columns,
      issues: [
        issue({ id: "a", position: -4 }),
        issue({ id: "b", position: -2 }),
        issue({ id: "c", position: -1 }),
      ],
    });
    expect(write?.position).toBe(-3); // above b(-2)
  });

  it("a drop onto a middle card takes the midpoint of its neighbours", () => {
    const columns = buildColumns({ grouping: "status", statuses, agents });
    const write = resolveDrop({
      overId: "c",
      draggedId: "a",
      grouping: "status",
      columns,
      issues: [
        issue({ id: "a", position: -4 }),
        issue({ id: "b", position: -2 }),
        issue({ id: "c", position: -1 }),
      ],
    });
    expect(write?.position).toBe(-1.5); // between b(-2) and c(-1)
  });
});

describe("slot math", () => {
  it("empty column takes the top slot", () => {
    expect(slotPosition([], 0)).toBe(-1);
  });

  it("beyond the last card is plus one, above the first is minus one", () => {
    const column = [issue({ id: "a", position: -3 }), issue({ id: "b", position: -1 })];
    expect(slotPosition(column, 2)).toBe(0);
    expect(slotPosition(column, 0)).toBe(-4);
    expect(slotPosition(column, 1)).toBe(-2);
  });

  it("slotAtCard finds the neighbour slot or nothing", () => {
    const column = [issue({ id: "a", position: -3 }), issue({ id: "b", position: -1 })];
    expect(slotAtCard(column, "b")).toBe(-2);
    expect(slotAtCard(column, "nope")).toBeNull();
  });
});
