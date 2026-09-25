import type pino from "pino";

import type { WorkerService } from "./service.js";
import { WorkerRunAlreadyActiveError, type WorkerStore } from "./worker-store.js";

/**
 * Turning a wake into an executed run.
 *
 * The loop is deliberately small and re-entrant: it does one pass over the
 * waiting work, and it is asked to run again after a run settles. Two things make
 * the re-ask necessary rather than optional.
 *
 * A message that arrives *during* a run cannot wake the worker that is already
 * running, because one worker runs one thing at a time. If nobody looked again
 * when that run finished, the message would sit unread forever — so settling a
 * run schedules another pass.
 *
 * The other is a daemon restart. Messages left unread by a run that never
 * settled are picked up by the first pass on boot, which is why candidates are
 * a query rather than something remembered in memory.
 */
export interface WorkerWakeLoopOptions {
  service: WorkerService;
  logger: pino.Logger;
  /** Injected so a test can drive passes explicitly instead of racing a timer. */
  schedule?: (run: () => void) => () => void;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 5_000;

export class WorkerWakeLoop {
  private readonly service: WorkerService;
  private readonly logger: pino.Logger;
  private readonly intervalMs: number;
  private readonly schedule: (run: () => void) => () => void;
  private started = false;
  private unschedule: (() => void) | null = null;
  /** One pass at a time; a pass can ask for the next while it is still running. */
  private passInFlight = false;
  private passRequested = false;
  private closed = false;

  /**
   * Which messages this process has already tried to wake each worker for.
   *
   * This is what stops a failing wake from being retried forever. A wake that
   * does not finish releases its messages, so a candidate query alone would hand
   * the same broken worker the same messages on every tick, and each attempt
   * creates an agent session that costs real money. Remembering the attempts
   * rather than counting them keeps the good half: unread work is never dropped,
   * and *new* work always gets a try, while a message already failed once is
   * left for a human to notice.
   *
   * In memory, deliberately. A restart therefore gets one more attempt at
   * whatever is still waiting, which is the behaviour wanted once whatever broke
   * it has plausibly been fixed.
   */
  private readonly attempted = new Map<string, Set<string>>();

  /** Runs started by this loop, so shutdown can settle them rather than strand them. */
  private readonly activeRuns = new Set<string>();

  constructor(options: WorkerWakeLoopOptions) {
    this.service = options.service;
    this.logger = options.logger;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.schedule =
      options.schedule ??
      ((run) => {
        const timer = setInterval(run, this.intervalMs);
        // A daemon that only has a timer keeping it alive should still be exitable.
        timer.unref?.();
        return () => clearInterval(timer);
      });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.closed = false;
    this.unschedule = this.schedule(() => {
      void this.runPass();
    });
    // Kick once on start: work left behind by a previous process is waiting.
    void this.runPass();
  }

  stop(): void {
    this.closed = true;
    this.started = false;
    this.unschedule?.();
    this.unschedule = null;
  }

  /** Ask for a pass now, which is what a send does after it wakes somebody. */
  requestPass(): void {
    void this.runPass();
  }

  /**
   * One pass over the waiting work.
   *
   * Coalesced: a pass asked for while one is running sets a flag instead of
   * starting a second, and the running one picks up whatever arrived. Without
   * that, a burst of messages would queue bursts of passes that all see the same
   * empty candidate list.
   */
  async runPass(): Promise<void> {
    if (this.closed) return;
    if (this.passInFlight) {
      this.passRequested = true;
      return;
    }
    this.passInFlight = true;
    try {
      do {
        this.passRequested = false;
        await this.dispatchCandidates();
      } while (this.passRequested);
    } finally {
      this.passInFlight = false;
    }
  }

  private async dispatchCandidates(): Promise<void> {
    const store: WorkerStore = this.service.getStore();
    for (const candidate of store.listWakeCandidates()) {
      const already = this.attempted.get(candidate.workerId) ?? new Set<string>();
      const fresh = candidate.messageIds.filter((id) => !already.has(id));
      if (fresh.length === 0) {
        // Every message here was already tried and released. Leaving it is the
        // decision: retrying it is what remembering attempts exists to prevent.
        continue;
      }
      try {
        await this.dispatch(store, candidate, fresh);
      } catch (error) {
        // A wake that could not even be recorded is logged and left unread, so
        // the next pass tries again. Losing the message would be worse than
        // retrying it.
        this.logger.error(
          { workerId: candidate.workerId, groupId: candidate.groupId, err: error },
          "Failed to dispatch a worker wake",
        );
      }
    }
  }

  private async dispatch(
    store: WorkerStore,
    candidate: { workerId: string; groupId: string; messageIds: string[] },
    /** Only the messages not yet tried in this process. */
    fresh: readonly string[],
  ): Promise<void> {
    const runId = `wrun_${Math.random().toString(16).slice(2, 14)}`;

    // Creating the run is the claim. If another process won the race, this one
    // has nothing to do: its messages are that run's, or will be picked up when
    // it settles.
    let run;
    try {
      run = store.createRun({
        runId,
        groupId: candidate.groupId,
        workerId: candidate.workerId,
        triggerMessageIds: fresh,
      });
    } catch (error) {
      if (error instanceof WorkerRunAlreadyActiveError) return;
      throw error;
    }

    // Recorded once this loop owns the messages, and before the wake runs rather
    // than after it succeeds: the point is to avoid re-trying them, and a wake
    // that dies partway still tried. Recording it before the claim went out would
    // mark another process's messages as tried whenever this one lost a race,
    // stranding them in this process.
    const attempted = this.attempted.get(candidate.workerId) ?? new Set<string>();
    for (const messageId of fresh) attempted.add(messageId);
    this.attempted.set(candidate.workerId, attempted);

    this.activeRuns.add(run.runId);
    let completed = false;
    try {
      const outcome = await this.executeAndSettle(store, run);
      completed = outcome.state === "completed";
      if (completed) {
        // Consumed, so forget them. Keeping them would let the set grow without
        // bound on a busy worker.
        const waiting = this.attempted.get(run.workerId);
        if (waiting) {
          for (const messageId of run.triggerMessageIds) waiting.delete(messageId);
          if (waiting.size === 0) this.attempted.delete(run.workerId);
        }
      }
    } finally {
      this.activeRuns.delete(run.runId);
    }

    // A message that arrived during this run is genuinely unhandled, and only
    // this loop will look. Asked after a settled run rather than on a timer, so
    // a burst of sends costs one extra pass rather than one per tick.
    if (completed) {
      this.requestPass();
    }
  }

  /**
   * Execute one wake and settle its run, whatever happened.
   *
   * The settle also happens on the throwing path, because a run left `running`
   * is worse than any outcome recorded against it: candidates skip a worker with
   * a run in flight, so an unsettled run silently blocks that worker for the rest
   * of the process. Settling as failed releases its messages instead.
   */
  private async executeAndSettle(
    store: WorkerStore,
    run: { runId: string; groupId: string; workerId: string; triggerMessageIds: string[] },
  ): Promise<{ state: "completed" | "failed"; reason?: string }> {
    try {
      const outcome = await this.service.executeWake({
        runId: run.runId,
        groupId: run.groupId,
        workerId: run.workerId,
        messageIds: run.triggerMessageIds,
        onSession: (sessionId: string) => {
          store.attachRunSession({ runId: run.runId, sessionId });
        },
      });
      store.settleRun({
        runId: run.runId,
        state: outcome.state,
        ...(outcome.reason ? { failureReason: outcome.reason } : {}),
      });
      return outcome;
    } catch (error) {
      // Settling as failed releases the messages, which is the recovery path the
      // store is built for. Swallowing the error is not: the caller logs it.
      store.settleRun({
        runId: run.runId,
        state: "failed",
        failureReason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Runs this loop started and has not settled.
   *
   * Exposed for shutdown: a process exiting with a run still marked running would
   * strand that worker's messages until the next pass, which on a restart is the
   * boot pass.
   */
  activeRunIds(): string[] {
    return [...this.activeRuns];
  }
}
