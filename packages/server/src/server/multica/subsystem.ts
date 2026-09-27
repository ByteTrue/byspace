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
import { seedSecretary } from "./secretary.js";
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
    logger: options.logger,
  });

  // Kicked on enqueue (the fast path) and on a timer (the crash-recovery
  // path: a task left queued by a restart is picked up on the next tick).
  let drainScheduled = false;
  const drain = (): void => {
    void executor.drain().catch((error: unknown) => {
      options.logger.warn({ err: error }, "multica drain failed");
    });
  };
  const kickDrain = (): void => {
    if (drainScheduled) {
      return;
    }
    drainScheduled = true;
    setTimeout(() => {
      drainScheduled = false;
      drain();
    }, 50);
  };
  const timer = setInterval(drain, 30_000);
  timer.unref?.();

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
  return { store, kickDrain };
}
