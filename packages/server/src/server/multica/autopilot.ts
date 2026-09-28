/**
 * The autopilot engine: declarative triggers that create work on a schedule
 * or on demand. Translated from `server/internal/service/autopilot.go` and
 * the scheduler's `jobs_autopilot.go`.
 *
 * Two execution modes, as the source defines them:
 *   - create_issue: the trigger opens a NEW issue (title from the template,
 *     the only supported placeholder being {{date}} in the trigger's
 *     timezone) assigned to the autopilot's assignee, and the run hangs off
 *     that issue through the ordinary trigger path;
 *   - run_only: no issue — the task goes straight to the assignee with the
 *     autopilot's description as its brief (the source inserts such tasks
 *     with a NULL issue_id, which migration 033 made possible).
 *
 * Two concurrency policies of the source's three: skip (an in-flight run of
 * the same autopilot suppresses this firing) and queue (fire anyway; the
 * queue's own per-agent bound still serializes execution). replace needs a
 * cancellation surface this form factor has not built and is refused at
 * creation.
 *
 * webhook triggers may be stored but not fired: there is no HTTP surface in
 * this form factor, and a silent no-op there would read as a broken
 * schedule, so dispatching one fails loudly.
 */
import { randomUUID } from "node:crypto";

import { computeNextRunAt } from "../schedule/cron.js";
import { willEnqueueRun } from "./trigger-engine.js";
import type { AutopilotRow, AutopilotRunRow, AutopilotTriggerRow } from "./rows.js";
import { interpolateIssueTitle } from "./rows.js";
import type { MulticaStore } from "./store.js";

export interface AutopilotDispatchResult {
  readonly run: AutopilotRunRow;
  readonly fired: boolean;
  readonly reason: string | null;
}

/**
 * Fire one trigger. The run row is the durable record of the attempt —
 * skipped and failed firings are rows too, exactly as the source's
 * autopilot_run statuses say.
 */
export function dispatchAutopilot(input: {
  store: MulticaStore;
  autopilot: AutopilotRow;
  trigger: AutopilotTriggerRow | null;
  source: "schedule" | "manual" | "api";
  now: Date;
}): AutopilotDispatchResult {
  const { store, autopilot, trigger, now } = input;
  const refusal = refusalBeforeDispatch(store, autopilot, trigger, input.source);
  if (refusal) {
    return refusal;
  }

  const run = runForSlot(store, autopilot, trigger, input.source);
  try {
    return fireRun(store, autopilot, trigger, run, now);
  } catch (error) {
    // A dispatch that throws must not leave the run in flight forever:
    // an unsettled run is what the skip policy reads, so a stranded row
    // would silence every future firing.
    const message = error instanceof Error ? error.message : String(error);
    return {
      run: store.updateAutopilotRun({ id: run.id, status: "failed", failureReason: message }),
      fired: false,
      reason: message,
    };
  }
}

function fireRun(
  store: MulticaStore,
  autopilot: AutopilotRow,
  trigger: AutopilotTriggerRow | null,
  run: AutopilotRunRow,
  now: Date,
): AutopilotDispatchResult {
  if (autopilot.executionMode === "create_issue") {
    const template = autopilot.issueTitleTemplate ?? autopilot.title;
    const issue = store.createIssue({
      title: interpolateIssueTitle(template, now, trigger?.timezone ?? "UTC"),
      description: autopilot.description,
      creatorType: "owner",
      creatorId: "owner",
      assigneeType: autopilot.assigneeType,
      assigneeId: autopilot.assigneeId,
      status: "todo",
    });
    const updated = store.updateAutopilotRun({
      id: run.id,
      status: "issue_created",
      issueId: issue.id,
    });
    // The issue's own creation path enqueues its first run through the
    // shared predicate — leaving backlog is what starts work, and an
    // autopilot's issue is no exception.
    enqueueForNewIssue(store, issue.id);
    store.touchAutopilotLastRun(autopilot.id, now);
    return { run: updated, fired: true, reason: null };
  }

  // run_only: the task carries no issue (033 made that representable) and
  // its brief is the autopilot's description.
  const task = store.createTask({
    agentId:
      autopilot.assigneeType === "agent"
        ? autopilot.assigneeId
        : resolveSquadLeader(store, autopilot.assigneeId),
    issueId: null,
    autopilotRunId: run.id,
    triggerSummary: `autopilot ${autopilot.title}`,
  });
  const updated = store.updateAutopilotRun({
    id: run.id,
    status: "running",
    taskId: task.id,
  });
  store.touchAutopilotLastRun(autopilot.id, now);
  return { run: updated, fired: true, reason: null };
}

/**
 * The three refusals that precede any dispatch: a paused/archived autopilot,
 * a webhook trigger with no HTTP surface, and the skip policy against an
 * in-flight run. Each records a run row — a suppressed firing is still an
 * attempt the audit trail should show, as the source's skipped status says.
 */
function refusalBeforeDispatch(
  store: MulticaStore,
  autopilot: AutopilotRow,
  trigger: AutopilotTriggerRow | null,
  source: "schedule" | "manual" | "api",
): AutopilotDispatchResult | null {
  if (autopilot.status !== "active") {
    return skip(store, autopilot, trigger, source, "autopilot is not active");
  }
  if (trigger?.kind === "webhook") {
    const run = store.createAutopilotRun({
      autopilotId: autopilot.id,
      triggerId: trigger.id,
      source,
    });
    const reason = "webhook triggers have no HTTP surface in this form factor";
    return {
      run: store.updateAutopilotRun({ id: run.id, status: "failed", failureReason: reason }),
      fired: false,
      reason,
    };
  }
  if (
    autopilot.concurrencyPolicy === "skip" &&
    store.listInFlightAutopilotRuns(autopilot.id).length > 0
  ) {
    return skip(store, autopilot, trigger, source, "a run is already in flight");
  }
  return null;
}

function skip(
  store: MulticaStore,
  autopilot: AutopilotRow,
  trigger: AutopilotTriggerRow | null,
  source: "schedule" | "manual" | "api",
  reason: string,
): AutopilotDispatchResult {
  const run = runForSlot(store, autopilot, trigger, source);
  return {
    run: store.updateAutopilotRun({ id: run.id, status: "skipped", failureReason: reason }),
    fired: false,
    reason,
  };
}

/**
 * One run row per (trigger, planned_at) slot — the source's unique index.
 * A skip, a retry or a re-fire of the same slot reuses the row rather than
 * colliding with it.
 */
function runForSlot(
  store: MulticaStore,
  autopilot: AutopilotRow,
  trigger: AutopilotTriggerRow | null,
  source: "schedule" | "manual" | "api",
): AutopilotRunRow {
  const plannedAt = trigger?.nextRunAt ?? null;
  if (trigger && plannedAt !== null) {
    const existing = store.getAutopilotRunForSlot(trigger.id, plannedAt);
    if (existing) {
      return existing;
    }
  }
  return store.createAutopilotRun({
    autopilotId: autopilot.id,
    triggerId: trigger?.id ?? null,
    source,
    plannedAt,
  });
}

function resolveSquadLeader(store: MulticaStore, squadId: string): string {
  // The squad's leader is a column, not a member role: a squad dispatches
  // through its leader exactly as an issue assigned to a squad does.
  return store.getSquad(squadId).leaderId;
}

/** The issue-create path's enqueue, without the session wrapper. */
function enqueueForNewIssue(store: MulticaStore, issueId: string): void {
  const issue = store.getIssue(issueId);
  const decision = willEnqueueRun({
    store,
    issue,
    isCreate: true,
    assigneeChanged: false,
    statusChanged: false,
    prevStatus: "backlog",
  });
  if (!decision) {
    return;
  }
  store.createTask({
    agentId: decision.agentId,
    issueId: issue.id,
    triggerSummary: `${decision.source} → ${decision.assigneeType}`,
  });
}

/**
 * The schedule tick: every due schedule trigger of an active autopilot
 * fires, then advances. Advancing happens after dispatch so a failed
 * dispatch still consumes its slot (the source advances on the same path
 * that records the attempt).
 */
export function tickAutopilots(input: {
  store: MulticaStore;
  now: Date;
  onEnqueued?: () => void;
}): AutopilotDispatchResult[] {
  const { store, now } = input;
  const results: AutopilotDispatchResult[] = [];
  for (const trigger of store.listDueAutopilotTriggers(now)) {
    const autopilot = store.getAutopilot(trigger.autopilotId);
    const result = dispatchAutopilot({ store, autopilot, trigger, source: "schedule", now });
    results.push(result);
    // Advance past every occurrence up to now — a missed or failed slot is
    // dropped, as the source's CatchUpLatestOnly plans the latest due
    // occurrence rather than replaying old ones.
    const next =
      trigger.cronExpression !== null
        ? computeNextRunAt(
            { type: "cron", expression: trigger.cronExpression, timezone: trigger.timezone },
            now,
          ).toISOString()
        : null;
    store.advanceAutopilotTrigger(trigger.id, next, now);
    if (result.fired) {
      input.onEnqueued?.();
    }
  }
  return results;
}

/** A fresh id for callers that need to pre-announce a run (RPC layer). */
export function newRunId(): string {
  return randomUUID();
}
