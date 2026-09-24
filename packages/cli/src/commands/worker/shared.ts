import type { OutputSchema } from "../../output/index.js";

/**
 * Output shapes for the worker commands.
 *
 * The daemon's payloads are reused rather than restated, so a field added to a
 * worker or a task shows up here without a second definition to keep in sync.
 */

export interface WorkerRow {
  workerId: string;
  name: string;
  templateId: string;
  status: string;
  workspacePath: string;
}

export const workerSchema: OutputSchema<WorkerRow> = {
  idField: "workerId",
  columns: [
    { header: "WORKER ID", field: "workerId", width: 20 },
    { header: "NAME", field: "name", width: 20 },
    { header: "ROLE", field: "templateId", width: 22 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "WORKSPACE", field: "workspacePath", width: 40 },
  ],
};

export interface WorkerTaskRow {
  taskId: string;
  workerId: string;
  title: string;
  state: string;
}

export const workerTaskSchema: OutputSchema<WorkerTaskRow> = {
  idField: "taskId",
  columns: [
    { header: "TASK ID", field: "taskId", width: 20 },
    { header: "WORKER", field: "workerId", width: 20 },
    { header: "STATE", field: "state", width: 14 },
    { header: "TITLE", field: "title", width: 40 },
  ],
};

export interface WorkerGroupRow {
  groupId: string;
  name: string;
  projectId: string;
  members: string;
}

export const workerGroupSchema: OutputSchema<WorkerGroupRow> = {
  idField: "groupId",
  columns: [
    { header: "GROUP ID", field: "groupId", width: 20 },
    { header: "NAME", field: "name", width: 24 },
    { header: "PROJECT", field: "projectId", width: 24 },
    { header: "MEMBERS", field: "members", width: 40 },
  ],
};
