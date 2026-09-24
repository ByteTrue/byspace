import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type {
  WorkerActivityDay,
  WorkerGoalSummary,
  WorkerGroupSummary,
  WorkerTaskSummary,
} from "@bytetrue/protocol/worker/rpc-schemas";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * Loading the worker domain across connected hosts.
 *
 * Follows the aggregated-load pattern the schedules list already uses: a flat
 * list tagged with its host, where one failing host does not take the screen
 * down with it.
 *
 * A host that answers with an empty worker list and one that refuses the
 * request are different states and are reported separately: the first means "no
 * workers yet", the second means "this host cannot do workers".
 */

export const workersQueryBaseKey = ["workers"] as const;

export interface WorkerHostInput {
  serverId: string;
  serverName: string;
}

export interface WorkerRuntimeSnapshot {
  connectionStatus: string;
}

export interface WorkerRuntime {
  getClient(
    serverId: string,
  ): Pick<
    DaemonClient,
    | "listWorkers"
    | "listWorkerTemplates"
    | "listWorkerTasks"
    | "listWorkerGroups"
    | "getWorkerGoal"
    | "getWorkerActivity"
  > | null;
  getSnapshot(serverId: string): WorkerRuntimeSnapshot | null | undefined;
}

export type WorkerTaskState = WorkerTaskSummary["state"];

export interface AggregatedWorker {
  id: string;
  name: string;
  templateId: string;
  /** Resolved role title when the host's catalog still has the template. */
  templateTitle: string | null;
  /** The role's one-line summary, for the roster card. Null when the role is gone. */
  templateDescription: string | null;
  status: "online" | "offline";
  createdAt: string;
  updatedAt: string;
  serverId: string;
  serverName: string;
}

/** A task tagged with its owning worker and host, so one flat list can render. */
export interface AggregatedWorkerTask {
  taskId: string;
  workerId: string;
  title: string;
  /**
   * The session that ran this task, once it has one.
   *
   * The conversation is that session, so this is what a task opens. Null before
   * the first run: a task that has not run has nothing to talk to.
   */
  agentId: string | null;
  state: WorkerTaskSummary["state"];
  createdAt: string;
  updatedAt: string;
  serverId: string;
  serverName: string;
}

/** A group tagged with the host it came from. */
export interface AggregatedWorkerGroup extends WorkerGroupSummary {
  serverId: string;
  serverName: string;
  /**
   * The group's objective, or null when none is set yet.
   *
   * Fetched per group rather than carried on the group: the objective lives in
   * the goal entity, which also owns the budget and version.
   */
  goal: WorkerGoalSummary | null;
}

export interface WorkerTemplateOption {
  id: string;
  title: string;
  /** The role's own one-line summary, shown on the roster card. */
  description: string;
  skills: string[];
  serverId: string;
  serverName: string;
}

export interface WorkerHostError {
  serverId: string;
  serverName: string;
  message: string;
}

export type WorkerLoadState =
  | { status: "connecting" }
  | { status: "loading" }
  | {
      status: "loaded";
      workers: AggregatedWorker[];
      templates: WorkerTemplateOption[];
      tasks: AggregatedWorkerTask[];
      groups: AggregatedWorkerGroup[];
      /**
       * Daily activity per worker, keyed by host and worker id.
       *
       * Fetched with the roster rather than when a detail view opens, so opening
       * a worker does not wait on a round trip. One entry per day that had work.
       */
      activity: Map<string, WorkerActivityDay[]>;
      hostErrors: WorkerHostError[];
    };

export interface FetchWorkersInput {
  hosts: readonly WorkerHostInput[];
  runtime: WorkerRuntime;
}

/**
 * A host the runtime has not finished with yet. `idle` counts because a host
 * that has not started connecting is still expected to.
 */
function isHostSettling(snapshot: WorkerRuntimeSnapshot | null | undefined): boolean {
  if (!snapshot) return true;
  return snapshot.connectionStatus === "connecting" || snapshot.connectionStatus === "idle";
}

/**
 * Run something that is allowed to fail, with an empty result when it does.
 *
 * `.catch()` only handles a rejected promise; a method that throws before
 * returning one escapes it. Every optional fetch here goes through this, so
 * "best-effort" holds even when the call itself is the thing that fails.
 *
 * The empty value is a partial of the payload rather than a whole one: naming
 * only the field this code reads means adding a field elsewhere cannot break it,
 * and the caller decides what an empty list looks like for its own type.
 */
async function bestEffort<T>(run: () => Promise<T>, empty: Partial<T>): Promise<Partial<T>> {
  try {
    return await run();
  } catch {
    return empty;
  }
}

/** A host that can be asked for workers right now. */
function connectedClient(
  host: WorkerHostInput,
  runtime: WorkerRuntime,
): Pick<
  DaemonClient,
  | "listWorkers"
  | "listWorkerTemplates"
  | "listWorkerTasks"
  | "listWorkerGroups"
  | "getWorkerGoal"
  | "getWorkerActivity"
> | null {
  const snapshot = runtime.getSnapshot(host.serverId);
  if (!snapshot || snapshot.connectionStatus !== "online") return null;
  return runtime.getClient(host.serverId);
}

export async function fetchAggregatedWorkers(input: FetchWorkersInput): Promise<WorkerLoadState> {
  const hasAskableHost = input.hosts.some((host) => connectedClient(host, input.runtime) !== null);
  // Nothing askable and nothing settling means every host is genuinely unusable
  // (offline, erroring). That is a loaded state with host errors, not "still
  // connecting"; reporting it as connecting would spin forever.
  const hasSettlingHost = input.hosts.some((host) =>
    isHostSettling(input.runtime.getSnapshot(host.serverId)),
  );
  if (!hasAskableHost && hasSettlingHost) {
    return { status: "connecting" };
  }

  const workers: AggregatedWorker[] = [];
  const templates: WorkerTemplateOption[] = [];
  const tasks: AggregatedWorkerTask[] = [];
  const groups: AggregatedWorkerGroup[] = [];
  const activity = new Map<string, WorkerActivityDay[]>();
  const hostErrors: WorkerHostError[] = [];

  await Promise.all(
    input.hosts.map(async (host) => {
      const client = connectedClient(host, input.runtime);
      if (!client) return;
      try {
        // Workers and their catalog are the critical path: without them there is
        // no roster. Tasks and groups are best-effort, because a host that
        // cannot answer for them should still show its workers rather than being
        // reported as entirely broken.
        const [workerResult, templateResult] = await Promise.all([
          client.listWorkers(),
          client.listWorkerTemplates(),
        ]);
        const taskResult = await bestEffort(() => client.listWorkerTasks(), { tasks: [] });
        const groupResult = await bestEffort(() => client.listWorkerGroups(), { groups: [] });
        // Goals are best-effort like tasks: a group whose objective cannot be
        // read should still appear with its roster.
        const goalEntries = await Promise.all(
          (groupResult.groups ?? []).map(async (group) => {
            const goal = await bestEffort(() => client.getWorkerGoal(group.id), {}).then(
              (payload) => payload.goal ?? null,
            );
            return [group.id, goal] as const;
          }),
        );
        const goalsByGroup = new Map(goalEntries);

        const templateById = new Map(
          templateResult.templates.map((template) => [template.id, template]),
        );
        for (const template of templateResult.templates) {
          templates.push({
            id: template.id,
            title: template.title,
            description: template.description,
            skills: [...template.skills],
            serverId: host.serverId,
            serverName: host.serverName,
          });
        }
        for (const worker of workerResult.workers) {
          workers.push({
            id: worker.id,
            name: worker.name,
            templateId: worker.templateId,
            templateTitle: templateById.get(worker.templateId)?.title ?? null,
            templateDescription: templateById.get(worker.templateId)?.description ?? null,
            status: worker.status,
            createdAt: worker.createdAt,
            updatedAt: worker.updatedAt,
            serverId: host.serverId,
            serverName: host.serverName,
          });
        }
        for (const task of taskResult.tasks ?? []) {
          tasks.push({
            taskId: task.taskId,
            workerId: task.workerId,
            title: task.title,
            agentId: task.agentId,
            state: task.state,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            serverId: host.serverId,
            serverName: host.serverName,
          });
        }
        // Best-effort like tasks and goals: a host that cannot report activity
        // should still show its roster.
        const activityEntries = await Promise.all(
          workerResult.workers.map(async (worker) => {
            const payload = await bestEffort(() => client.getWorkerActivity(worker.id), {});
            return [`${host.serverId}:${worker.id}`, payload.days ?? []] as const;
          }),
        );
        for (const [key, days] of activityEntries) activity.set(key, days);

        for (const group of groupResult.groups ?? []) {
          groups.push({
            ...group,
            serverId: host.serverId,
            serverName: host.serverName,
            goal: goalsByGroup.get(group.id) ?? null,
          });
        }
      } catch (error) {
        hostErrors.push({
          serverId: host.serverId,
          serverName: host.serverName,
          message: toErrorMessage(error),
        });
      }
    }),
  );

  return { status: "loaded", workers, templates, tasks, groups, activity, hostErrors };
}
