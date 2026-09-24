import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type { WorkerGroupSummary, WorkerTaskSummary } from "@bytetrue/protocol/worker/rpc-schemas";
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
    "listWorkers" | "listWorkerTemplates" | "listWorkerTasks" | "listWorkerGroups"
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
}

export interface WorkerTemplateOption {
  id: string;
  title: string;
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

/** A host that can be asked for workers right now. */
function connectedClient(
  host: WorkerHostInput,
  runtime: WorkerRuntime,
): Pick<
  DaemonClient,
  "listWorkers" | "listWorkerTemplates" | "listWorkerTasks" | "listWorkerGroups"
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
        const taskResult = await client.listWorkerTasks().catch(() => ({ tasks: [] }));
        const groupResult = await client.listWorkerGroups().catch(() => ({ groups: [] }));

        const titleById = new Map(
          templateResult.templates.map((template) => [template.id, template.title]),
        );
        for (const template of templateResult.templates) {
          templates.push({
            id: template.id,
            title: template.title,
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
            templateTitle: titleById.get(worker.templateId) ?? null,
            status: worker.status,
            createdAt: worker.createdAt,
            updatedAt: worker.updatedAt,
            serverId: host.serverId,
            serverName: host.serverName,
          });
        }
        for (const task of taskResult.tasks) {
          tasks.push({
            taskId: task.taskId,
            workerId: task.workerId,
            title: task.title,
            state: task.state,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            serverId: host.serverId,
            serverName: host.serverName,
          });
        }
        for (const group of groupResult.groups) {
          groups.push({ ...group, serverId: host.serverId, serverName: host.serverName });
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

  return { status: "loaded", workers, templates, tasks, groups, hostErrors };
}
