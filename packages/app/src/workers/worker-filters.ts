import type { AggregatedWorker, AggregatedWorkerTask } from "@/workers/aggregated-workers";

/**
 * Filtering and sorting the roster.
 *
 * Pure and separate from the screen: "what counts as a match" is stated once and
 * tested without a renderer, and the count beside the controls cannot disagree
 * with the list below it.
 *
 * The controls follow the reference product's roster. Its environment filter is
 * not reproduced: that one separates local from remote runs, and this domain has
 * no remote worker, so there is no field to filter on rather than no data.
 */

export type WorkerStatusFilter = "all" | "online" | "offline";

export type WorkerSort = "default" | "name" | "lastRun" | "tasks" | "created";

export const WORKER_STATUS_OPTIONS: readonly { value: WorkerStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
];

export const WORKER_SORT_OPTIONS: readonly { value: WorkerSort; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "name", label: "Name" },
  { value: "lastRun", label: "Last run" },
  { value: "tasks", label: "Tasks" },
  { value: "created", label: "Created" },
];

export interface WorkerFilters {
  search: string;
  status: WorkerStatusFilter;
  /** A role template id, or null for every role. */
  roleId: string | null;
  sort: WorkerSort;
}

export const DEFAULT_WORKER_FILTERS: WorkerFilters = {
  search: "",
  status: "all",
  roleId: null,
  sort: "default",
};

/** Whether anything is narrowed, which decides if a "clear" control is wanted. */
export function filtersAreActive(filters: WorkerFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.status !== "all" ||
    filters.roleId !== null ||
    filters.sort !== "default"
  );
}

/** The newest activity timestamp for one worker, or null when it has none. */
export function lastRunAt(
  worker: AggregatedWorker,
  tasks: readonly AggregatedWorkerTask[],
): string | null {
  let latest: string | null = null;
  for (const task of tasks) {
    if (task.serverId !== worker.serverId || task.workerId !== worker.id) continue;
    if (latest === null || task.updatedAt > latest) latest = task.updatedAt;
  }
  return latest;
}

/** How many tasks one worker owns, on its own host. */
export function taskCount(
  worker: AggregatedWorker,
  tasks: readonly AggregatedWorkerTask[],
): number {
  let count = 0;
  for (const task of tasks) {
    if (task.serverId === worker.serverId && task.workerId === worker.id) count += 1;
  }
  return count;
}

/** The roles present in a roster, for the role filter's options. */
export function availableRoles(
  workers: readonly AggregatedWorker[],
): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const worker of workers) {
    if (!seen.has(worker.templateId)) {
      seen.set(worker.templateId, worker.templateTitle ?? worker.templateId);
    }
  }
  return [...seen.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The roster as the list should show it.
 *
 * Filtering runs before sorting, so the sort only ever sees the rows that will
 * be drawn and the count beside the controls is the count below them.
 */
export function selectVisibleWorkers(
  workers: readonly AggregatedWorker[],
  tasks: readonly AggregatedWorkerTask[],
  filters: WorkerFilters,
): AggregatedWorker[] {
  const needle = filters.search.trim().toLowerCase();

  const filtered = workers.filter((worker) => {
    if (filters.status === "online" && worker.status !== "online") return false;
    if (filters.status === "offline" && worker.status !== "offline") return false;
    if (filters.roleId !== null && worker.templateId !== filters.roleId) return false;
    if (needle.length === 0) return true;
    // The reference product's field promises "name or role", so both match.
    const haystack = [worker.name, worker.templateTitle ?? "", worker.templateId]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });

  if (filters.sort === "default") return filtered;

  const sorted = [...filtered];
  switch (filters.sort) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "lastRun": {
      // A worker that has never run sorts last: "recently active" is the useful
      // end of this list, and an absent timestamp is not the most recent one.
      sorted.sort((a, b) => {
        const at = lastRunAt(a, tasks);
        const bt = lastRunAt(b, tasks);
        if (at === null && bt === null) return a.name.localeCompare(b.name);
        if (at === null) return 1;
        if (bt === null) return -1;
        return bt.localeCompare(at);
      });
      break;
    }
    case "tasks":
      sorted.sort((a, b) => {
        const delta = taskCount(b, tasks) - taskCount(a, tasks);
        return delta !== 0 ? delta : a.name.localeCompare(b.name);
      });
      break;
    case "created":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
  }
  return sorted;
}
