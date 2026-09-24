import type { Command } from "commander";
import type { CommandError, CommandOptions, ListResult, SingleResult } from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import { workerGroupSchema, type WorkerGroupRow } from "./shared.js";

interface GroupInput {
  id: string;
  name: string;
  projectId: string;
  members: Array<{ workerId: string; role: "coordinator" | "member" }>;
}

/**
 * The roster is rendered as `role:workerId` pairs in the group's own order, so
 * the coordinator is visible without a second lookup.
 */
function toGroupRow(group: GroupInput): WorkerGroupRow {
  return {
    groupId: group.id,
    name: group.name,
    projectId: group.projectId,
    members: group.members.map((member) => `${member.role}:${member.workerId}`).join(" "),
  };
}

export async function runGroupLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<WorkerGroupRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.listWorkerGroups();
    return { type: "list", data: payload.groups.map(toGroupRow), schema: workerGroupSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface GroupCreateOptions extends CommandOptions {
  name?: string;
  projectId?: string;
  coordinator?: string;
  member?: string[];
}

export interface GroupAddWorkerOptions extends CommandOptions {
  worker?: string[];
  role?: string;
}

export async function runGroupCreateCommand(
  options: GroupCreateOptions,
  _command: Command,
): Promise<SingleResult<WorkerGroupRow>> {
  const name = options.name?.trim();
  if (!name) {
    throw { code: "MISSING_NAME", message: "--name is required" } satisfies CommandError;
  }
  const projectId = options.projectId?.trim();
  if (!projectId) {
    throw {
      code: "MISSING_PROJECT_ID",
      message: "--project-id is required",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.createWorkerGroup({
      name,
      projectId,
      ...(options.coordinator !== undefined ? { coordinatorWorkerId: options.coordinator } : {}),
      ...(options.member !== undefined ? { memberWorkerIds: options.member } : {}),
    });
    return { type: "single", data: toGroupRow(payload.group), schema: workerGroupSchema };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_GROUP_CREATE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Add workers to a group.
 *
 * One coordinator per group is a database constraint, so a second one is
 * refused by the daemon. The refusal is surfaced as-is rather than pre-checked,
 * because the check that matters is the one that holds under concurrency.
 */
export async function runGroupAddWorkerCommand(
  groupId: string,
  options: GroupAddWorkerOptions,
  _command: Command,
): Promise<ListResult<WorkerGroupRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    let group: GroupInput | null = null;
    for (const workerId of options.worker ?? []) {
      const payload = await client.addWorkerGroupMember({
        groupId,
        workerId,
        role: options.role === "coordinator" ? "coordinator" : "member",
      });
      group = payload.group;
    }
    if (!group) {
      throw {
        code: "NO_WORKER_GIVEN",
        message: "At least one --worker is required",
        details: "Usage: byspace worker group add-waker <group> --worker <worker-id>",
      } satisfies CommandError;
    }
    return { type: "list", data: [toGroupRow(group)], schema: workerGroupSchema };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_GROUP_ADD_MEMBER_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runGroupRemoveWorkerCommand(
  groupId: string,
  workerId: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<WorkerGroupRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.removeWorkerGroupMember({ groupId, workerId });
    return { type: "single", data: toGroupRow(payload.group), schema: workerGroupSchema };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_GROUP_REMOVE_MEMBER_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
