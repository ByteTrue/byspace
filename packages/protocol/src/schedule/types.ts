import { z } from "zod";
import { AgentProviderSchema } from "../provider-manifest.js";

export const ScheduleStatusSchema = z.enum(["active", "paused", "completed"]);
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;

export const ScheduleCadenceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("every"),
    everyMs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().trim().min(1),
    timezone: z.string().trim().min(1).optional(),
  }),
]);
export type ScheduleCadence = z.infer<typeof ScheduleCadenceSchema>;

/**
 * The new-agent variant on its own, for callers that need its config shape.
 * Named rather than re-declared so the union and the standalone schema cannot
 * drift apart.
 */
export const NewAgentScheduleTargetSchema = z.object({
  type: z.literal("new-agent"),
  config: z.object({
    provider: AgentProviderSchema,
    cwd: z.string().trim().min(1),
    modeId: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    thinkingOptionId: z.string().trim().min(1).optional(),
    archiveOnFinish: z.boolean().optional(),
    isolation: z.enum(["local", "worktree"]).optional(),
    title: z.string().trim().min(1).nullable().optional(),
    providerOptions: z.record(z.string(), z.json()).optional(),
    featureValues: z.record(z.string(), z.unknown()).optional(),
    systemPrompt: z.string().optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type NewAgentScheduleTarget = z.infer<typeof NewAgentScheduleTargetSchema>;

export const ScheduleTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent"),
    agentId: z.guid(),
  }),
  z.object({
    type: z.literal("worker"),
    /**
     * The worker the trigger hands its prompt to. A schedule firing becomes a
     * task for this worker, created and run through the same path a person
     * handing work over uses — so the task carries state, history, and a
     * conversation to open, and the worker's guard and one-run invariant apply.
     */
    workerId: z.string().min(1),
  }),
  NewAgentScheduleTargetSchema,
]);
export type ScheduleTarget = z.infer<typeof ScheduleTargetSchema>;

export const ScheduleRunSchema = z.object({
  id: z.string(),
  scheduledFor: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  agentId: z.guid().nullable(),
  workspaceId: z.string().nullable().optional(),
  output: z.string().nullable(),
  error: z.string().nullable(),
});
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;

export const StoredScheduleSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  prompt: z.string().min(1),
  cadence: ScheduleCadenceSchema,
  target: ScheduleTargetSchema,
  status: ScheduleStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  pausedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  maxRuns: z.number().int().positive().nullable(),
  runs: z.array(ScheduleRunSchema),
});
export type StoredSchedule = z.infer<typeof StoredScheduleSchema>;

export const ScheduleSummarySchema = StoredScheduleSchema.omit({
  runs: true,
});
export type ScheduleSummary = z.infer<typeof ScheduleSummarySchema>;

export interface CreateScheduleInput {
  name?: string | null;
  prompt: string;
  cadence: ScheduleCadence;
  target: ScheduleTarget;
  maxRuns?: number | null;
  expiresAt?: string | null;
  runOnCreate?: boolean | null;
}

export interface UpdateScheduleNewAgentConfig {
  provider?: string;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  archiveOnFinish?: boolean;
  isolation?: "local" | "worktree";
  cwd?: string;
}

export interface UpdateScheduleInput {
  id: string;
  name?: string | null;
  prompt?: string;
  cadence?: ScheduleCadence;
  newAgentConfig?: UpdateScheduleNewAgentConfig;
  maxRuns?: number | null;
  expiresAt?: string | null;
}

export interface ScheduleExecutionResult {
  agentId: string | null;
  output: string | null;
}
