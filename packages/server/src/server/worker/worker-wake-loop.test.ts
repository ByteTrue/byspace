/**
 * Tests for the wake loop.
 *
 * The service and store are real and only the runner is faked, because the
 * properties worth pinning are about the wiring between them: whether a woken
 * worker can identify itself, whether an error can strand a worker, and whether
 * a broken wake stops being retried.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkerService } from "./service.js";
import type { WorkerRunner } from "./worker-runner.js";
import { WorkerWakeLoop } from "./worker-wake-loop.js";

const silentLogger = pino({ level: "silent" });

let home: string;
let aliceId: string;
let bobId: string;
let groupId: string;

/** A service whose wake path is the given fake, plus the loop that drives it. */
function harness(runner: Partial<WorkerRunner>) {
  const service = new WorkerService({
    byspaceHome: home,
    logger: silentLogger,
    runner: runner as WorkerRunner,
  });
  const loop = new WorkerWakeLoop({
    service,
    logger: silentLogger,
    // Never on a clock: a test drives passes itself.
    schedule: () => () => {},
  });
  // A loop that was never started runs no passes, so tests start it against the
  // void schedule above: enabled, and never firing on its own.
  loop.start();
  return { service, loop };
}

function emptyRunner() {
  return { wake: vi.fn() } as unknown as Partial<WorkerRunner>;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "worker-wake-"));
  const service = new WorkerService({ byspaceHome: home, logger: silentLogger });
  try {
    const alice = await service.createWorker({
      name: "Alice",
      templateId: "project-administrator",
      workspacePath: join(home, "alice"),
    });
    const bob = await service.createWorker({
      name: "Bob",
      templateId: "backend-engineer",
      workspacePath: join(home, "bob"),
    });
    aliceId = alice.id;
    bobId = bob.id;
    groupId = service.createGroup({
      name: "Pricing",
      projectId: "prj_a",
      coordinatorWorkerId: aliceId,
      memberWorkerIds: [bobId],
    }).id;
  } finally {
    service.close();
  }
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A wake that attaches a session, finishes, and reports success. */
function succeeding(agentId = "sess_bob") {
  const wake = vi.fn(async (input: Parameters<WorkerRunner["wake"]>[0]) => {
    input.onSessionCreated(agentId);
    return { kind: "succeeded" as const, sessionId: agentId };
  });
  return { wake };
}

/** A wake that attaches a session and then reports the given failing kind. */
function failing(kind: "blocked" | "failed", reason: string, agentId = "sess_bob") {
  const wake = vi.fn(async (input: Parameters<WorkerRunner["wake"]>[0]) => {
    input.onSessionCreated(agentId);
    return { kind, sessionId: agentId, reason };
  });
  return { wake };
}

function address(service: WorkerService, body = "need the schema") {
  return service.sendMessage({
    groupId,
    senderWorkerId: aliceId,
    body,
    audience: [bobId],
  });
}

describe("wake loop", () => {
  it("does nothing when nothing is waiting", async () => {
    const runner = succeeding();
    const { service, loop } = harness(runner);
    try {
      await loop.runPass();
      expect(runner.wake).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  });

  it("wakes the worker a message addressed", async () => {
    const runner = succeeding();
    const { service, loop } = harness(runner);
    try {
      address(service);
      await loop.runPass();

      expect(runner.wake).toHaveBeenCalledTimes(1);
      const input = runner.wake.mock.calls[0]![0];
      expect(input.workerId).toBe(bobId);
      expect(input.groupId).toBe(groupId);
      // The framing carries what arrived: that is the worker's whole view of why
      // it was woken.
      expect(input.wakePrompt).toContain("need the schema");
    } finally {
      service.close();
    }
  });

  it("attaches the session before the worker gets its turn", async () => {
    // Ordering *is* the identity model. A worker's first action can be sending a
    // reply, and that resolves its sender from the attached session, so
    // attaching after the turn would make the first reply unattributable.
    let resolvedDuringTurn: string | null = null;
    let serviceRef: WorkerService | null = null;
    const runner = {
      wake: vi.fn(async (input: Parameters<WorkerRunner["wake"]>[0]) => {
        input.onSessionCreated("sess_bob");
        // Inside the turn, which is when a worker would send its reply.
        resolvedDuringTurn = serviceRef!.resolveSenderFromSession("sess_bob").workerId;
        return { kind: "succeeded" as const, sessionId: "sess_bob" };
      }),
    };
    const { service, loop } = harness(runner);
    serviceRef = service;
    try {
      address(service);
      await loop.runPass();

      expect(resolvedDuringTurn).toBe(bobId);
      // And once the run has settled, the same session no longer speaks. That is
      // the other half of the rule: authority is current.
      expect(() => service.resolveSenderFromSession("sess_bob")).toThrow(
        /belongs to a completed run, which can no longer send/,
      );
    } finally {
      service.close();
    }
  });

  it("marks the woken message consumed once the run completes", async () => {
    const { service, loop } = harness(succeeding());
    try {
      const { message } = address(service);
      expect(service.listInbox(bobId).map((entry) => entry.message.messageId)).toContain(
        message.messageId,
      );

      await loop.runPass();

      // Out of the inbox entirely: read, so nothing is waiting any more.
      expect(service.listInbox(bobId)).toEqual([]);
    } finally {
      service.close();
    }
  });

  it("settles the run it started", async () => {
    const { service, loop } = harness(succeeding());
    try {
      address(service);
      await loop.runPass();
      // Nothing in flight, and the session's run is no longer running.
      expect(service.getStore().listRunningRuns()).toEqual([]);
      expect(service.getStore().getRunBySession("sess_bob")?.state).toBe("completed");
    } finally {
      service.close();
    }
  });

  it("leaves the messages unconsumed when the wake is blocked", async () => {
    // A worker stopped by a permission decision has not finished, so its
    // messages must not be marked read.
    const { service, loop } = harness(failing("blocked", "awaiting approval"));
    try {
      const { message } = address(service);
      await loop.runPass();

      expect(service.getStore().getRunBySession("sess_bob")).toMatchObject({
        state: "failed",
        failureReason: "awaiting approval",
      });
      // Released by the store. It is not in this loop's inbox view because the
      // row is unread while the run is failed, and the loop will not retry a
      // message it already attempted.
      expect(service.listInbox(bobId).map((entry) => entry.message.messageId)).toContain(
        message.messageId,
      );
    } finally {
      service.close();
    }
  });

  it("settles the run when the wake throws", async () => {
    // The hazard: candidates skip a worker with a run in flight, so a run left
    // running by an exception silently blocks that worker for the rest of the
    // process.
    const { service, loop } = harness({
      wake: vi.fn(async () => {
        throw new Error("runner exploded");
      }),
    });
    try {
      address(service);
      await loop.runPass();
      expect(service.getStore().listRunningRuns()).toEqual([]);
    } finally {
      service.close();
    }
  });

  it("does not retry a failed wake for the same message", async () => {
    // Each attempt creates an agent session that costs real money, so a
    // permanently broken worker must not be re-woken for the same work.
    const runner = failing("failed", "boom");
    const { service, loop } = harness(runner);
    try {
      address(service);
      await loop.runPass();
      await loop.runPass();
      await loop.runPass();
      expect(runner.wake).toHaveBeenCalledTimes(1);
    } finally {
      service.close();
    }
  });

  it("still wakes for new messages after an earlier failure", async () => {
    // The bound is per message, not per worker. New work keeps moving while an
    // old failure stops being retried.
    const runner = failing("failed", "boom");
    const { service, loop } = harness(runner);
    try {
      address(service, "first");
      await loop.runPass();
      expect(runner.wake).toHaveBeenCalledTimes(1);

      address(service, "second");
      await loop.runPass();
      expect(runner.wake).toHaveBeenCalledTimes(2);
      expect(runner.wake.mock.calls[1]![0].wakePrompt).toContain("second");
    } finally {
      service.close();
    }
  });

  it("picks up a message that arrived during a run", async () => {
    // Why the loop asks for a second pass: a message that lands while a worker
    // is running cannot wake it, and without looking again it would sit unread
    // forever.
    let wakes = 0;
    let serviceRef: WorkerService | null = null;
    const wake = vi.fn(async (input: Parameters<WorkerRunner["wake"]>[0]) => {
      wakes += 1;
      const sessionId = `sess_${wakes}`;
      input.onSessionCreated(sessionId);
      if (wakes === 1) {
        // Sent while this run is in flight, so it could not wake anybody by
        // itself: the worker addressed is already running.
        serviceRef!.sendMessage({
          groupId,
          senderWorkerId: aliceId,
          body: "also this",
          audience: [bobId],
        });
      }
      return { kind: "succeeded" as const, sessionId };
    });
    const { service, loop } = harness({ wake });
    serviceRef = service;
    try {
      address(service, "first");
      await loop.runPass();

      expect(wake).toHaveBeenCalledTimes(2);
      expect(wake.mock.calls[1]![0].wakePrompt).toContain("also this");
      // Both consumed, so nothing is left waiting.
      expect(service.listInbox(bobId)).toEqual([]);
    } finally {
      service.close();
    }
  });

  it("survives two passes racing one worker", async () => {
    // The database allows one run per worker, so a losing dispatch must return
    // quietly rather than throw and lose the messages it did not claim.
    const { service, loop } = harness(succeeding());
    try {
      address(service);
      await Promise.all([loop.runPass(), loop.runPass()]);
      expect(service.getStore().listRunningRuns()).toEqual([]);
    } finally {
      service.close();
    }
  });

  it("consumes nothing when there is no execution path", async () => {
    // A service without a runner cannot wake anybody. Its run has to settle as
    // failed and leave the message waiting rather than mark it handled.
    const service = new WorkerService({ byspaceHome: home, logger: silentLogger });
    const loop = new WorkerWakeLoop({
      service,
      logger: silentLogger,
      schedule: () => () => {},
    });
    loop.start();
    try {
      const { message } = service.sendMessage({
        groupId,
        senderWorkerId: aliceId,
        body: "hello",
        audience: [bobId],
      });
      await loop.runPass();
      expect(service.getStore().listRunningRuns()).toEqual([]);
      expect(service.listInbox(bobId).map((entry) => entry.message.messageId)).toContain(
        message.messageId,
      );
    } finally {
      service.close();
    }
  });

  it("starts nothing once stopped", async () => {
    const runner = emptyRunner();
    const { service, loop } = harness(runner);
    try {
      address(service);
      loop.stop();
      await loop.runPass();
      expect(runner.wake).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  });
});
