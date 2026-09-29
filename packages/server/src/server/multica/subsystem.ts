/**
 * The multica subsystem assembled in one place: store, executor, drain
 * scheduling, and the secretary seed.
 *
 * Extracted from the daemon factory — that function is at the repo's
 * complexity ceiling, and the subsystem has a natural boundary: everything
 * here is joined by the store and the executor's late kick callback.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type pino from "pino";

import type { AgentManager } from "../agent/agent-manager.js";
import type { BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import { openMulticaDatabase } from "./database.js";
import { MulticaExecutor } from "./executor.js";
import { MIGRATIONS } from "./migrations/index.js";
import { tickAutopilots } from "./autopilot.js";
import { seedSecretary } from "./secretary.js";
import { seedBuiltinRoster } from "./builtin-roster-seed.js";
import { MulticaStore } from "./store.js";

export interface MulticaSubsystemOptions {
  readonly byspaceHome: string;
  readonly agentManager: AgentManager;
  readonly createAgent: BoundCreateAgentCommand;
  readonly createWorkspaceForDirectory: (input: {
    cwd: string;
    firstAgentContext: { prompt: string };
  }) => Promise<{ cwd: string; workspaceId: string }>;
  readonly provisionSecretaryWorkspace: (input: {
    cwd: string;
    title: string;
  }) => Promise<{ cwd: string; workspaceId: string }>;
  /**
   * Whether the executor actually runs queued tasks. Production: true.
   * Verification harnesses set BYSPACE_MULTICA_EXECUTION=off so a scripted
   * end-to-end pass never spawns real model sessions — dispatch and the
   * store stay fully live, only execution is dark (notes/004: a verifier
   * that silently pays for real runs is not a verifier).
   */
  readonly executionEnabled?: boolean;
  readonly logger: pino.Logger;
}

export function createMulticaSubsystem(options: MulticaSubsystemOptions): {
  store: MulticaStore;
  kickDrain: () => void;
} {
  // Failing to open the store must abort startup — a replica without its
  // schema is not a degraded mode, it is a wrong one.
  const store = new MulticaStore(
    openMulticaDatabase(path.join(options.byspaceHome, "multica", "multica.db")),
    { migrations: MIGRATIONS },
  );
  options.logger.info("Multica store initialized");

  // v1 workspace: each issue's runs work in the daemon's multica work
  // directory, registered through the same workspace provisioning path the
  // schedule service uses, so a run's agent is a first-class workspace agent.
  // Project-bound checkouts are later engine-slice work.
  // Kicked on enqueue (the fast path) and on a timer (the crash-recovery
  // path: a task left queued by a restart is picked up on the next tick).
  let drainScheduled = false;
  const drain = (): void => {
    void executor.drain().catch((error: unknown) => {
      options.logger.warn({ err: error }, "multica drain failed");
    });
  };
  const executionEnabled = options.executionEnabled ?? true;
  const kickDrain = (): void => {
    if (!executionEnabled || drainScheduled) {
      return;
    }
    drainScheduled = true;
    setTimeout(() => {
      drainScheduled = false;
      drain();
    }, 50);
  };
  const executor = new MulticaExecutor({
    store,
    agentManager: options.agentManager,
    createAgent: options.createAgent,
    resolveWorkspace: async (issueId: string) => {
      const dir = path.join(options.byspaceHome, "multica", "work", issueId);
      await mkdir(dir, { recursive: true });
      const workspace = await options.createWorkspaceForDirectory({
        cwd: dir,
        firstAgentContext: { prompt: `multica issue ${issueId}` },
      });
      return { cwd: workspace.cwd, workspaceId: workspace.workspaceId };
    },
    onEnqueued: kickDrain,
    resolveAutopilotWorkspace: async (autopilotId: string) => {
      const dir = path.join(options.byspaceHome, "multica", "autopilot", autopilotId);
      await mkdir(dir, { recursive: true });
      const workspace = await options.createWorkspaceForDirectory({
        cwd: dir,
        firstAgentContext: { prompt: `multica autopilot ${autopilotId}` },
      });
      return { cwd: workspace.cwd, workspaceId: workspace.workspaceId };
    },
    logger: options.logger,
  });

  // The wakeup tick: subscriptions whose evidence or time has come. Same
  // cadence family as the drain; the two are independent passes.
  const tick = (): void => {
    try {
      store.purgeExpiredReceipts(new Date());
      for (const result of tickAutopilots({
        store,
        now: new Date(),
        onEnqueued: kickDrain,
      })) {
        if (!result.fired && result.reason) {
          options.logger.info(
            { autopilotId: result.run.autopilotId, reason: result.reason },
            "autopilot firing skipped",
          );
        }
      }
      for (const { wakeup, evidence } of store.listReadyWakeups(new Date())) {
        try {
          store.dispatchWakeup(wakeup, evidence, new Date());
          kickDrain();
        } catch (error) {
          options.logger.error({ err: error, wakeupId: wakeup.id }, "wakeup dispatch failed");
        }
      }
    } catch (error) {
      options.logger.error({ err: error }, "wakeup tick failed");
    }
  };
  const wakeupTimer = setInterval(tick, 15_000);
  wakeupTimer.unref?.();

  if (executionEnabled) {
    const timer = setInterval(drain, 30_000);
    timer.unref?.();
  }

  const seedSecretaryWorkspace = async (): Promise<void> => {
    try {
      const seed = await seedSecretary(
        store,
        options.provisionSecretaryWorkspace,
        options.byspaceHome,
      );
      options.logger.info({ workspaceId: seed.workspaceId }, "Secretary workspace ready");
    } catch (error) {
      // The secretary's workspace is the owner's front door; a failure here
      // must be loud, but a workspace hiccup must not take the daemon down.
      options.logger.error({ err: error }, "Failed to seed the secretary workspace");
    }
  };
  void seedSecretaryWorkspace();

  // The built-in roster: the eight roles the practice line earned become
  // assignable teammates at first boot, the same seed discipline the
  // secretary's own row set. Idempotent by system_key; a failure here is
  // loud but never fatal, the same rule as the secretary's workspace.
  try {
    const seeded = seedBuiltinRoster(store);
    options.logger.info({ seeded }, "Built-in role roster seeded");
  } catch (error) {
    options.logger.error({ err: error }, "Failed to seed the built-in roster");
  }
  return { store, kickDrain };
}
