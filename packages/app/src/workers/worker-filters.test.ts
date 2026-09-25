/**
 * Tests for roster filtering and sorting.
 *
 * The definitions worth pinning: what counts as a search match, where a worker
 * that has never run lands, and that the count and the list cannot disagree.
 */
import { describe, expect, it } from "vitest";

import type { AggregatedWorker, AggregatedWorkerTask } from "@/workers/aggregated-workers";
import {
  availableRoles,
  DEFAULT_WORKER_FILTERS,
  filtersAreActive,
  lastRunAt,
  selectVisibleWorkers,
  taskCount,
  WORKER_SORT_OPTIONS,
  WORKER_STATUS_OPTIONS,
  type WorkerFilters,
} from "@/workers/worker-filters";

function worker(overrides: Partial<AggregatedWorker> = {}): AggregatedWorker {
  return {
    id: "wkr_1",
    name: "Alice",
    templateId: "frontend-developer",
    templateTitle: "Frontend Developer",
    templateDescription: null,
    status: "online",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    serverId: "s1",
    serverName: "host",
    ...overrides,
  };
}

function task(overrides: Partial<AggregatedWorkerTask> = {}): AggregatedWorkerTask {
  return {
    taskId: "t1",
    workerId: "wkr_1",
    title: "Work",
    agentId: null,
    state: "assigned",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    serverId: "s1",
    serverName: "host",
    ...overrides,
  };
}

function select(
  overrides: Partial<WorkerFilters> = {},
  roster = ROSTER,
  tasks: AggregatedWorkerTask[] = [],
) {
  return selectVisibleWorkers(roster, tasks, { ...DEFAULT_WORKER_FILTERS, ...overrides });
}

const ALICE = worker({ id: "w1", name: "Alice" });
const BOB = worker({
  id: "w2",
  name: "Bob",
  templateId: "qa-engineer",
  templateTitle: "QA Engineer",
  status: "offline",
  createdAt: "2026-09-10T00:00:00.000Z",
});
const CAROL = worker({
  id: "w3",
  name: "Carol",
  templateId: "qa-engineer",
  templateTitle: "QA Engineer",
  createdAt: "2026-09-05T00:00:00.000Z",
});
const ROSTER = [ALICE, BOB, CAROL];

describe("option lists", () => {
  it("offers the reference product's status and sort values", () => {
    // Pinned against the product's own dropdowns, so a filter cannot quietly
    // drop a choice the reference offers.
    expect(WORKER_STATUS_OPTIONS.map((o) => o.value)).toEqual(["all", "online", "offline"]);
    expect(WORKER_SORT_OPTIONS.map((o) => o.value)).toEqual([
      "default",
      "name",
      "lastRun",
      "tasks",
      "created",
    ]);
  });
});

describe("search", () => {
  it("matches the worker's name", () => {
    expect(select({ search: "bob" }).map((w) => w.id)).toEqual(["w2"]);
  });

  it("matches the role, as the field promises", () => {
    expect(select({ search: "qa eng" }).map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(select({ search: "  ALICE " }).map((w) => w.id)).toEqual(["w1"]);
  });

  it("returns everything for an empty search", () => {
    expect(select({ search: "   " })).toHaveLength(3);
  });

  it("returns nothing when nothing matches", () => {
    expect(select({ search: "zzz" })).toEqual([]);
  });
});

describe("status and role filters", () => {
  it("keeps only online workers", () => {
    expect(select({ status: "online" }).map((w) => w.id)).toEqual(["w1", "w3"]);
  });

  it("keeps only offline workers", () => {
    expect(select({ status: "offline" }).map((w) => w.id)).toEqual(["w2"]);
  });

  it("keeps one role", () => {
    expect(select({ roleId: "qa-engineer" }).map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("lists each role once, by its display title", () => {
    expect(availableRoles(ROSTER)).toEqual([
      { id: "frontend-developer", label: "Frontend Developer" },
      { id: "qa-engineer", label: "QA Engineer" },
    ]);
  });

  it("falls back to the id when a role has no title", () => {
    // A role the host no longer ships still has to be selectable.
    expect(availableRoles([worker({ templateTitle: null })])).toEqual([
      { id: "frontend-developer", label: "frontend-developer" },
    ]);
  });
});

describe("sorting", () => {
  it("leaves the given order alone by default", () => {
    expect(select({}, ROSTER).map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("sorts by name", () => {
    expect(select({ sort: "name" }, ROSTER).map((w) => w.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("sorts by creation, newest first", () => {
    expect(select({ sort: "created" }, ROSTER).map((w) => w.id)).toEqual(["w2", "w3", "w1"]);
  });

  it("puts workers that have never run last when sorting by last run", () => {
    const tasks = [task({ workerId: "w1", updatedAt: "2026-09-20T00:00:00.000Z" })];
    expect(select({ sort: "lastRun" }, ROSTER, tasks).map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("breaks last-run ties by name, so the order is stable", () => {
    const tasks = [
      task({ workerId: "w1", updatedAt: "2026-09-20T00:00:00.000Z" }),
      task({ workerId: "w2", updatedAt: "2026-09-20T00:00:00.000Z" }),
    ];
    expect(select({ sort: "lastRun" }, ROSTER, tasks).map((w) => w.name)).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("sorts by task count, most first", () => {
    const tasks = [
      task({ taskId: "a", workerId: "w3" }),
      task({ taskId: "b", workerId: "w3" }),
      task({ taskId: "c", workerId: "w1" }),
    ];
    expect(select({ sort: "tasks" }, ROSTER, tasks).map((w) => w.id)).toEqual(["w3", "w1", "w2"]);
  });

  it("filters before sorting", () => {
    const tasks = [task({ taskId: "a", workerId: "w1" }), task({ taskId: "b", workerId: "w2" })];
    expect(select({ status: "offline", sort: "tasks" }, ROSTER, tasks).map((w) => w.id)).toEqual([
      "w2",
    ]);
  });
});

describe("counts", () => {
  it("counts only the worker's own tasks, on its own host", () => {
    const tasks = [
      task({ taskId: "a", workerId: "w1" }),
      task({ taskId: "b", workerId: "w1", serverId: "s2" }),
      task({ taskId: "c", workerId: "w2" }),
    ];
    expect(taskCount(ALICE, tasks)).toBe(1);
  });

  it("reports the newest update as the last run", () => {
    const tasks = [
      task({ taskId: "a", workerId: "w1", updatedAt: "2026-09-10T00:00:00.000Z" }),
      task({ taskId: "b", workerId: "w1", updatedAt: "2026-09-20T00:00:00.000Z" }),
      task({ taskId: "c", workerId: "w1", updatedAt: "2026-09-15T00:00:00.000Z" }),
    ];
    expect(lastRunAt(ALICE, tasks)).toBe("2026-09-20T00:00:00.000Z");
  });

  it("reports no last run for a worker with no tasks", () => {
    expect(lastRunAt(ALICE, [])).toBeNull();
  });
});

describe("active filters", () => {
  it("treats the defaults as inactive", () => {
    expect(filtersAreActive(DEFAULT_WORKER_FILTERS)).toBe(false);
  });

  it("treats whitespace-only search as inactive", () => {
    expect(filtersAreActive({ ...DEFAULT_WORKER_FILTERS, search: "  " })).toBe(false);
  });

  it("treats any narrowing as active", () => {
    expect(filtersAreActive({ ...DEFAULT_WORKER_FILTERS, status: "online" })).toBe(true);
    expect(filtersAreActive({ ...DEFAULT_WORKER_FILTERS, sort: "name" })).toBe(true);
    expect(filtersAreActive({ ...DEFAULT_WORKER_FILTERS, roleId: "qa-engineer" })).toBe(true);
  });
});
