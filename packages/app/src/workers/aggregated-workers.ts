import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * Loading the worker domain across connected hosts.
 *
 * Follows the aggregated-load pattern the schedules list already uses: the
 * result is a flat list tagged with its host, and a host that fails does not
 * take the screen down with it. The worker domain is new and optional, so a
 * daemon that does not serve it yet must degrade to "this host has nothing",
 * not to an error page.
 *
 * A daemon that answers with an empty worker list and one that refuses the
 * request entirely are different states and are reported separately: the first
 * means "no workers yet", the second means "this host cannot do workers".
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
  getClient(serverId: string): Pick<DaemonClient, "listWorkers" | "listWorkerTemplates"> | null;
  getSnapshot(serverId: string): WorkerRuntimeSnapshot | null | undefined;
}

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
      hostErrors: WorkerHostError[];
    };

export interface FetchWorkersInput {
  hosts: readonly WorkerHostInput[];
  runtime: WorkerRuntime;
}

/**
 * A host is only asked for workers once its connection is up. The runtime
 * snapshot is consulted rather than assumed, because a client object can exist
 * before the socket is usable.
 */
function connectedClient(
  host: WorkerHostInput,
  runtime: WorkerRuntime,
): Pick<DaemonClient, "listWorkers" | "listWorkerTemplates"> | null {
  const snapshot = runtime.getSnapshot(host.serverId);
  if (!snapshot || snapshot.connectionStatus !== "online") return null;
  return runtime.getClient(host.serverId);
}

export async function fetchAggregatedWorkers(input: FetchWorkersInput): Promise<WorkerLoadState> {
  const clients = input.hosts.map((host) => ({
    host,
    client: connectedClient(host, input.runtime),
  }));

  if (clients.length > 0 && clients.every((entry) => entry.client === null)) {
    return { status: "connecting" };
  }

  const workers: AggregatedWorker[] = [];
  const templates: WorkerTemplateOption[] = [];
  const hostErrors: WorkerHostError[] = [];

  await Promise.all(
    clients.map(async ({ host, client }) => {
      if (!client) return;
      try {
        // Fetch the catalog alongside the workers so a row can show the role
        // name rather than the template id.
        const [workerResult, templateResult] = await Promise.all([
          client.listWorkers(),
          client.listWorkerTemplates(),
        ]);

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
      } catch (error) {
        hostErrors.push({
          serverId: host.serverId,
          serverName: host.serverName,
          message: toErrorMessage(error),
        });
      }
    }),
  );

  return { status: "loaded", workers, templates, hostErrors };
}
