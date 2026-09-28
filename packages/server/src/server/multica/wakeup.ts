/**
 * The wakeup behavior layer: subscriptions that let an issue's state changes
 * wake agents on their own.
 *
 * Translated from the source's PG stored functions (518/520 event capture)
 * and `server/internal/service/issue_wakeup.go` (validate / dispatch / tick /
 * stop-on-close). The source runs capture inside DB triggers; this form runs
 * it inside the same write transactions, at the store's single write entries,
 * which is the Node equivalent of "the capture cannot be forgotten by a
 * caller".
 *
 * Semantics that carry over verbatim:
 *   - receipts are idempotent by (wakeup, revision, event_key) — ON CONFLICT
 *     DO NOTHING against the unique index migration 514 added;
 *   - a run never wakes the subscription it itself registered (self-trigger
 *     guard: the event's task is not the subscription's source task, and a
 *     task whose context names the wakeup never re-triggers it);
 *   - closed issues stop waking (done/cancelled, or a status-directory
 *     category of done/closed);
 *   - payloads carry references and changed field names only — never
 *     comment bodies, attachment URLs, or arbitrary metadata.
 */
import { computeNextRunAt } from "../schedule/cron.js";

export interface WakeupRow {
  readonly id: string;
  readonly issueId: string;
  readonly agentId: string;
  readonly createdBy: string;
  readonly sourceTaskId: string | null;
  readonly parentCommentId: string | null;
  readonly instruction: string;
  readonly kind: WakeupKind;
  readonly mode: WakeupMode;
  readonly eventTypes: readonly string[];
  readonly filterAgentId: string | null;
  readonly filterTaskId: string | null;
  readonly intervalSeconds: number | null;
  readonly cronExpression: string | null;
  readonly timezone: string;
  readonly nextFireAt: string | null;
  readonly enabled: boolean;
  readonly disabledAt: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WakeupKind = "event" | "at" | "every" | "cron";
export type WakeupMode = "once" | "continuous";

export interface WakeupCaptureInput {
  readonly issueId: string;
  readonly type: string;
  readonly key: string;
  readonly agentId: string | null;
  readonly taskId: string | null;
  readonly payload: Record<string, unknown>;
}

export const WAKEUP_SELECT = `id, issue_id, agent_id, created_by, source_task_id,
  parent_comment_id, instruction, kind, mode, event_types, filter_agent_id,
  filter_task_id, interval_seconds, cron_expression, timezone, next_fire_at,
  enabled, disabled_at, revision, created_at, updated_at`;

/** The dispatch-relevant readiness of one subscription. */
export interface ReadyWakeup {
  readonly wakeup: WakeupRow;
  /** Unprocessed evidence: receipts for event kinds, a synthesized one for time kinds. */
  readonly evidence: readonly Record<string, unknown>[];
}

export function mapWakeupRow(raw: Record<string, unknown>): WakeupRow {
  return {
    id: raw.id as string,
    issueId: raw.issue_id as string,
    agentId: raw.agent_id as string,
    createdBy: raw.created_by as string,
    sourceTaskId: (raw.source_task_id as string | null) ?? null,
    parentCommentId: (raw.parent_comment_id as string | null) ?? null,
    instruction: raw.instruction as string,
    kind: raw.kind as WakeupKind,
    mode: raw.mode as WakeupMode,
    eventTypes: JSON.parse((raw.event_types as string) || "[]") as string[],
    filterAgentId: (raw.filter_agent_id as string | null) ?? null,
    filterTaskId: (raw.filter_task_id as string | null) ?? null,
    intervalSeconds: (raw.interval_seconds as number | null) ?? null,
    cronExpression: (raw.cron_expression as string | null) ?? null,
    timezone: (raw.timezone as string) ?? "UTC",
    nextFireAt: (raw.next_fire_at as string | null) ?? null,
    enabled: (raw.enabled as number) === 1,
    disabledAt: (raw.disabled_at as string | null) ?? null,
    revision: raw.revision as number,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

/** Next fire time for a time-kind subscription, or null for event kinds. */
export function computeWakeupNextFire(
  input: {
    kind: WakeupKind;
    intervalSeconds: number | null;
    cronExpression: string | null;
    timezone: string;
    at?: string | null;
  },
  now: Date,
): string | null {
  if (input.kind === "at") {
    return input.at ?? null;
  }
  if (input.kind === "every") {
    const seconds = input.intervalSeconds;
    if (!seconds || seconds <= 0) {
      throw new Error("an every-wakeup needs a positive interval");
    }
    return new Date(now.getTime() + seconds * 1000).toISOString();
  }
  if (input.kind === "cron") {
    const expression = input.cronExpression;
    if (!expression) {
      throw new Error("a cron-wakeup needs an expression");
    }
    return computeNextRunAt(
      { type: "cron", expression, timezone: input.timezone },
      now,
    ).toISOString();
  }
  return null;
}
