/**
 * Tests for the worker RPC surface.
 *
 * These drive the real `WorkerSession` against a real `WorkerService` (a real
 * SQLite database in a temp directory, the real role templates, the real guard
 * rules) and then parse every emitted message with the actual protocol schemas.
 *
 * Parsing with the wire schemas is the point of the last step: a hand-written
 * fixture would keep passing after the response shape drifted away from what
 * clients validate. This makes the server and the protocol contract agree by
 * construction.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "@bytetrue/protocol/messages";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { WorkerSession } from "./worker-session.js";
import { WorkerService } from "../../worker/service.js";

interface Harness {
  session: WorkerSession;
  emitted: unknown[];
  service: WorkerService;
  close(): void;
}

function createHarness(dir: string): Harness {
  const emitted: unknown[] = [];
  const service = new WorkerService({
    byspaceHome: dir,
    databasePath: path.join(dir, "worker.db"),
    logger: createTestLogger(),
  });
  const session = new WorkerSession({
    host: { emit: (msg) => emitted.push(msg) },
    workerService: service,
    logger: pino({ level: "silent" }),
  });
  return {
    session,
    emitted,
    service,
    close: () => service.close(),
  };
}

/** Feed a raw request through the protocol schema so the test cannot invent a shape. */
function request(raw: Record<string, unknown>): never {
  return SessionInboundMessageSchema.parse(raw) as never;
}

/** Parse what the server emitted, so drift from the wire contract fails here. */
function takeOutbound(emitted: unknown[], index = -1): Record<string, unknown> {
  const message = emitted.at(index);
  expect(message).toBeDefined();
  return SessionOutboundMessageSchema.parse(message) as unknown as Record<string, unknown>;
}

let dir: string;
let harness: Harness;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "worker-session-"));
  harness = createHarness(dir);
});

afterEach(() => {
  harness.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("worker template RPC", () => {
  it("lists the shipped roles", async () => {
    await harness.session.handleTemplateListRequest(
      request({ type: "worker.template.list.request", requestId: "r1" }),
    );

    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("worker.template.list.response");
    const payload = message.payload as { requestId: string; templates: Array<{ id: string }> };
    expect(payload.requestId).toBe("r1");
    expect(payload.templates.map((t) => t.id)).toContain("frontend-developer");
  });
});

describe("worker worker RPC", () => {
  it("create returns a worker and the worker is then listable", async () => {
    await harness.session.handleWorkerCreateRequest(
      request({
        type: "worker.worker.create.request",
        requestId: "r2",
        name: "Alice",
        templateId: "frontend-developer",
      }),
    );

    const created = takeOutbound(harness.emitted);
    expect(created.type).toBe("worker.worker.create.response");
    const worker = (created.payload as { worker: { id: string; id_?: string } }).worker;
    expect(worker.id).toMatch(/^wkr_/);

    await harness.session.handleWorkerListRequest(
      request({ type: "worker.worker.list.request", requestId: "r3" }),
    );
    const listed = takeOutbound(harness.emitted);
    const workers = (listed.payload as { workers: Array<{ id: string }> }).workers;
    expect(workers.map((w) => w.id)).toEqual([worker.id]);
  });

  it("refuses an unknown template and says nothing was created", async () => {
    await harness.session.handleWorkerCreateRequest(
      request({
        type: "worker.worker.create.request",
        requestId: "r4",
        name: "Ghost",
        templateId: "no-such-role",
      }),
    );

    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("rpc_error");
    expect(JSON.stringify(message)).toContain("Unknown worker template");
    expect(harness.service.listWorkers()).toEqual([]);
  });

  it("get returns the worker with its tasks", async () => {
    await harness.session.handleWorkerCreateRequest(
      request({
        type: "worker.worker.create.request",
        requestId: "r5",
        name: "Alice",
        templateId: "qa-engineer",
      }),
    );
    const workerId = (takeOutbound(harness.emitted).payload as { worker: { id: string } }).worker
      .id;

    await harness.session.handleTaskCreateRequest(
      request({
        type: "worker.task.create.request",
        requestId: "r6",
        workerId,
        title: "Verify checkout",
      }),
    );

    await harness.session.handleWorkerGetRequest(
      request({ type: "worker.worker.get.request", requestId: "r7", workerId }),
    );
    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("worker.worker.get.response");
    const payload = message.payload as {
      worker: { id: string };
      tasks: Array<{ title: string; state: string }>;
    };
    expect(payload.worker.id).toBe(workerId);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]).toMatchObject({ title: "Verify checkout", state: "planned" });
  });

  it("reports an unknown worker as an rpc error", async () => {
    await harness.session.handleWorkerGetRequest(
      request({ type: "worker.worker.get.request", requestId: "r8", workerId: "wkr_nope" }),
    );
    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("rpc_error");
    expect(JSON.stringify(message)).toContain("Unknown worker");
  });
});

describe("worker task RPC", () => {
  let workerId: string;

  beforeEach(async () => {
    await harness.session.handleWorkerCreateRequest(
      request({
        type: "worker.worker.create.request",
        requestId: "setup",
        name: "Alice",
        templateId: "frontend-developer",
      }),
    );
    workerId = (takeOutbound(harness.emitted).payload as { worker: { id: string } }).worker.id;
  });

  async function createTask(): Promise<string> {
    await harness.session.handleTaskCreateRequest(
      request({
        type: "worker.task.create.request",
        requestId: "t-create",
        workerId,
        title: "Build pricing table",
      }),
    );
    return (takeOutbound(harness.emitted).payload as { task: { taskId: string } }).task.taskId;
  }

  it("walks a legal path and records history", async () => {
    const taskId = await createTask();

    for (const [toState, action] of [
      ["assigned", "assign_task"],
      ["in_progress", "ack_task"],
      ["submitted", "submit_task"],
      ["completed", "accept_task_result"],
    ] as const) {
      await harness.session.handleTaskTransitionRequest(
        request({
          type: "worker.task.transition.request",
          requestId: `t-${toState}`,
          taskId,
          toState,
          action,
          actor: "worker:lead",
        }),
      );
      const message = takeOutbound(harness.emitted);
      expect(message.type).toBe("worker.task.transition.response");
    }

    await harness.session.handleTaskHistoryRequest(
      request({ type: "worker.task.history.request", requestId: "t-hist", taskId }),
    );
    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("worker.task.history.response");
    const entries = (message.payload as { entries: Array<{ seq: number; toState: string }> })
      .entries;
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(entries.map((e) => e.toState)).toEqual([
      "assigned",
      "in_progress",
      "submitted",
      "completed",
    ]);
  });

  it("refuses an illegal transition with the reason and the way forward", async () => {
    const taskId = await createTask();

    await harness.session.handleTaskTransitionRequest(
      request({
        type: "worker.task.transition.request",
        requestId: "bad",
        taskId,
        toState: "completed",
        action: "accept_task_result",
        actor: "worker:lead",
      }),
    );

    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("rpc_error");
    const text = JSON.stringify(message);
    expect(text).toContain("Illegal worker task transition");
    expect(text).toContain("can only move to");
  });

  it("refuses an action the domain does not define", async () => {
    const taskId = await createTask();

    await harness.session.handleTaskTransitionRequest(
      request({
        type: "worker.task.transition.request",
        requestId: "bad-action",
        taskId,
        toState: "assigned",
        action: "yeet",
        actor: "worker:lead",
      }),
    );

    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("rpc_error");
    expect(JSON.stringify(message)).toContain("Unknown worker task action");
  });

  it("surfaces a transition on an unknown task rather than inventing one", async () => {
    await harness.session.handleTaskTransitionRequest(
      request({
        type: "worker.task.transition.request",
        requestId: "ghost",
        taskId: "wtk_nope",
        toState: "assigned",
        action: "assign_task",
        actor: "worker:lead",
      }),
    );
    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("rpc_error");
    expect(JSON.stringify(message)).toContain("Unknown worker task");
  });
});

describe("worker guard RPC", () => {
  it("returns a block verdict for disk destruction", async () => {
    await harness.session.handleGuardEvaluateRequest(
      request({
        type: "worker.guard.evaluate.request",
        requestId: "g1",
        command: "mkfs.ext4 /dev/sda1",
      }),
    );

    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("worker.guard.evaluate.response");
    const payload = message.payload as { decision: string; maxSeverity: string | null };
    expect(payload.decision).toBe("block");
    expect(payload.maxSeverity).toBe("CRITICAL");
  });

  it("returns allow for an ordinary command", async () => {
    await harness.session.handleGuardEvaluateRequest(
      request({
        type: "worker.guard.evaluate.request",
        requestId: "g2",
        command: "npm run typecheck",
      }),
    );
    const payload = takeOutbound(harness.emitted).payload as { decision: string };
    expect(payload.decision).toBe("allow");
  });

  it("lets the caller check a command without running it", async () => {
    // The response must carry the findings, not just the verdict, or a caller
    // cannot tell the user what was wrong.
    await harness.session.handleGuardEvaluateRequest(
      request({
        type: "worker.guard.evaluate.request",
        requestId: "g3",
        command: "rm -rf ./build",
      }),
    );
    const payload = takeOutbound(harness.emitted).payload as {
      decision: string;
      findings: Array<{ ruleId: string; remediation: string }>;
    };
    expect(payload.decision).toBe("confirm");
    expect(payload.findings.length).toBeGreaterThan(0);
    expect(payload.findings[0]!.remediation.length).toBeGreaterThan(0);
  });
});

describe("worker group RPC", () => {
  let workerIds: string[];

  beforeEach(async () => {
    workerIds = [];
    for (const [name, templateId] of [
      ["Lead", "project-administrator"],
      ["Alice", "frontend-developer"],
      ["Bob", "backend-engineer"],
    ] as const) {
      await harness.session.handleWorkerCreateRequest(
        request({
          type: "worker.worker.create.request",
          requestId: `create-${name}`,
          name,
          templateId,
        }),
      );
      workerIds.push(
        (takeOutbound(harness.emitted).payload as { worker: { id: string } }).worker.id,
      );
    }
  });

  it("creates a group with a roster in one call", async () => {
    const [lead, alice, bob] = workerIds as [string, string, string];

    await harness.session.handleGroupCreateRequest(
      request({
        type: "worker.group.create.request",
        requestId: "gc1",
        name: "Pricing page",
        projectId: "prj_abc",
        workspaceId: "ws_1",
        coordinatorWorkerId: lead,
        memberWorkerIds: [alice, bob],
      }),
    );

    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("worker.group.create.response");
    const group = (
      message.payload as {
        group: {
          id: string;
          name: string;
          projectId: string;
          workspaceId: string | null;
          status: string;
          members: Array<{ workerId: string; role: string }>;
        };
      }
    ).group;

    expect(group.id).toMatch(/^grp_/);
    expect(group).toMatchObject({
      name: "Pricing page",
      projectId: "prj_abc",
      workspaceId: "ws_1",
      status: "active",
    });
    // The coordinator is first, and named as such.
    expect(group.members.map((m) => `${m.role}:${m.workerId}`)).toEqual([
      `coordinator:${lead}`,
      `member:${alice}`,
      `member:${bob}`,
    ]);
  });

  it("does not list the coordinator twice when it is also a member", async () => {
    const [lead] = workerIds as [string];

    await harness.session.handleGroupCreateRequest(
      request({
        type: "worker.group.create.request",
        requestId: "gc2",
        name: "Solo",
        projectId: "prj_abc",
        coordinatorWorkerId: lead,
        memberWorkerIds: [lead],
      }),
    );

    const group = (takeOutbound(harness.emitted).payload as { group: { members: unknown[] } })
      .group;
    expect(group.members).toHaveLength(1);
  });

  it("leaves no group behind when the roster is rejected", async () => {
    // A group whose roster failed is not a group; keeping it would show an
    // empty team to the user and make the failure look like success.
    await harness.session.handleGroupCreateRequest(
      request({
        type: "worker.group.create.request",
        requestId: "gc3",
        name: "Doomed",
        projectId: "prj_abc",
        coordinatorWorkerId: "wkr_ghost",
      }),
    );

    expect(takeOutbound(harness.emitted).type).toBe("rpc_error");

    await harness.session.handleGroupListRequest(
      request({ type: "worker.group.list.request", requestId: "gl" }),
    );
    const groups = (takeOutbound(harness.emitted).payload as { groups: unknown[] }).groups;
    expect(groups).toEqual([]);
  });

  it("refuses a second coordinator and says why", async () => {
    const [lead, alice] = workerIds as [string, string];
    await harness.session.handleGroupCreateRequest(
      request({
        type: "worker.group.create.request",
        requestId: "gc4",
        name: "Pricing page",
        projectId: "prj_abc",
        coordinatorWorkerId: lead,
      }),
    );
    const groupId = (takeOutbound(harness.emitted).payload as { group: { id: string } }).group.id;

    await harness.session.handleGroupAddMemberRequest(
      request({
        type: "worker.group.add_member.request",
        requestId: "ga1",
        groupId,
        workerId: alice,
        role: "coordinator",
      }),
    );

    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("rpc_error");
    expect(JSON.stringify(message)).toContain("already has a coordinator");
  });

  it("answers a membership change with the whole roster", async () => {
    const [lead, alice] = workerIds as [string, string];
    await harness.session.handleGroupCreateRequest(
      request({
        type: "worker.group.create.request",
        requestId: "gc5",
        name: "Pricing page",
        projectId: "prj_abc",
        coordinatorWorkerId: lead,
      }),
    );
    const groupId = (takeOutbound(harness.emitted).payload as { group: { id: string } }).group.id;

    await harness.session.handleGroupAddMemberRequest(
      request({
        type: "worker.group.add_member.request",
        requestId: "ga2",
        groupId,
        workerId: alice,
        role: "member",
      }),
    );
    let group = (takeOutbound(harness.emitted).payload as { group: { members: unknown[] } }).group;
    expect(group.members).toHaveLength(2);

    await harness.session.handleGroupRemoveMemberRequest(
      request({
        type: "worker.group.remove_member.request",
        requestId: "gr1",
        groupId,
        workerId: alice,
      }),
    );
    group = (takeOutbound(harness.emitted).payload as { group: { members: unknown[] } }).group;
    expect(group.members).toHaveLength(1);
  });

  it("reports an unknown group as an rpc error", async () => {
    await harness.session.handleGroupAddMemberRequest(
      request({
        type: "worker.group.add_member.request",
        requestId: "ga3",
        groupId: "grp_missing",
        workerId: workerIds[0]!,
        role: "member",
      }),
    );
    const message = takeOutbound(harness.emitted);
    expect(message.type).toBe("rpc_error");
    expect(JSON.stringify(message)).toContain("Unknown worker group");
  });

  it("keeps groups scoped to their own project", async () => {
    const [lead] = workerIds as [string];
    for (const [requestId, name, projectId] of [
      ["a", "One", "prj_a"],
      ["b", "Two", "prj_b"],
    ] as const) {
      await harness.session.handleGroupCreateRequest(
        request({
          type: "worker.group.create.request",
          requestId,
          name,
          projectId,
          coordinatorWorkerId: lead,
        }),
      );
    }

    await harness.session.handleGroupListRequest(
      request({ type: "worker.group.list.request", requestId: "gl2" }),
    );
    const groups = (
      takeOutbound(harness.emitted).payload as { groups: Array<{ projectId: string }> }
    ).groups;
    expect(groups.map((group) => group.projectId).sort()).toEqual(["prj_a", "prj_b"]);
  });
});
