/**
 * Tests for the worker task transition table.
 *
 * The table is the single source of truth for task state, so it is tested as
 * data: every state's edges are enumerated, and the negative cases (illegal
 * edges, terminal states) are asserted explicitly rather than sampled.
 */
import { describe, expect, it } from "vitest";

import {
  IllegalWorkerTaskTransitionError,
  WORKER_TASK_PROGRESS_NOTE_MAX_LENGTH,
  WORKER_TASK_STATES,
  WORKER_TASK_TERMINAL_STATES,
  allowedNextStates,
  assertWorkerTaskTransition,
  canReportProgress,
  canTransition,
  isTerminalWorkerTaskState,
  suggestedAction,
  type WorkerTaskState,
} from "./worker-task-state.js";

const LEGAL_EDGES: Array<[WorkerTaskState, WorkerTaskState]> = [
  ["planned", "prepared"],
  ["planned", "assigned"],
  ["planned", "in_progress"],
  ["planned", "submitted"],
  ["planned", "cancelled"],
  ["prepared", "assigned"],
  ["prepared", "cancelled"],
  ["assigned", "in_progress"],
  ["assigned", "submitted"],
  ["assigned", "cancelled"],
  ["in_progress", "submitted"],
  ["in_progress", "cancelled"],
  ["submitted", "completed"],
  ["submitted", "revision"],
  ["submitted", "blocked"],
  ["submitted", "cancelled"],
];

function edgeKey(from: WorkerTaskState, to: WorkerTaskState): string {
  return `${from}->${to}`;
}

const legalEdgeKeys = new Set(LEGAL_EDGES.map(([from, to]) => edgeKey(from, to)));

describe("worker task state machine", () => {
  it("covers the full state set with no duplicates", () => {
    expect(new Set(WORKER_TASK_STATES).size).toBe(WORKER_TASK_STATES.length);
    expect(WORKER_TASK_STATES).toContain("submitted");
  });

  it.each(LEGAL_EDGES)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertWorkerTaskTransition(from, to)).not.toThrow();
  });

  it("rejects every edge not in the table", () => {
    // Exhaustive over the cross product: catches an accidental new edge just as
    // readily as a missing one.
    for (const from of WORKER_TASK_STATES) {
      for (const to of WORKER_TASK_STATES) {
        if (legalEdgeKeys.has(edgeKey(from, to)) || from === to) continue;
        expect(canTransition(from, to), `${from}->${to} should be illegal`).toBe(false);
        expect(() => assertWorkerTaskTransition(from, to), `${from}->${to}`).toThrow(
          IllegalWorkerTaskTransitionError,
        );
      }
    }
  });

  it("treats same-state moves as legal no-ops, not transitions", () => {
    // Idempotent re-delivery must not be an error and must not write history.
    for (const state of WORKER_TASK_STATES) {
      expect(canTransition(state, state)).toBe(true);
    }
  });

  it("makes the four terminal states sink states", () => {
    for (const state of WORKER_TASK_TERMINAL_STATES) {
      expect(allowedNextStates(state)).toHaveLength(0);
      expect(isTerminalWorkerTaskState(state)).toBe(true);
      for (const to of WORKER_TASK_STATES) {
        if (to === state) continue;
        expect(canTransition(state, to), `${state}->${to}`).toBe(false);
      }
    }
  });

  it("does not mark non-terminal states as terminal", () => {
    for (const state of WORKER_TASK_STATES) {
      if (WORKER_TASK_TERMINAL_STATES.includes(state)) continue;
      expect(isTerminalWorkerTaskState(state), state).toBe(false);
    }
  });

  it("names the action for each legal edge so callers can be redirected", () => {
    for (const [from, to] of LEGAL_EDGES) {
      expect(suggestedAction(from, to), `${from}->${to}`).not.toBeNull();
    }
  });

  it("explains the way forward in the rejection message", () => {
    const error = new IllegalWorkerTaskTransitionError("completed", "in_progress");
    expect(error.message).toContain("terminal");
    expect(error.message).toContain("new task");

    const midFlight = new IllegalWorkerTaskTransitionError("planned", "completed");
    expect(midFlight.message).toContain("'planned' can only move to");
  });

  it("only accepts progress reports while a task is actually in flight", () => {
    expect(canReportProgress("assigned")).toBe(true);
    expect(canReportProgress("in_progress")).toBe(true);
    expect(canReportProgress("planned")).toBe(false);
    expect(canReportProgress("submitted")).toBe(false);
    expect(canReportProgress("completed")).toBe(false);
  });

  it("bounds the progress note length", () => {
    expect(WORKER_TASK_PROGRESS_NOTE_MAX_LENGTH).toBeGreaterThan(0);
  });
});
