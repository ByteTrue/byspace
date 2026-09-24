import { z } from "zod";

/**
 * Wire schemas for the worker domain.
 *
 * Follows `docs/rpc-namespacing.md`: dotted namespaces with `.request` pairs
 * answering `.response`. Two namespaces cover the first slice:
 *
 * - `worker.template.*` — read-only role catalog
 * - `worker.worker.*`   — worker and task lifecycle
 *
 * Requests keep parameters at the top level and carry a `requestId`; responses
 * nest their result under `payload` so correlated data is unambiguous.
 *
 * Backward compatibility (`docs/protocol-compatibility.md`): these are new
 * namespaces, so nothing here narrows or removes an existing field. Old clients
 * simply never send them.
 */

export const WorkerTemplatePartSchema = z.enum(["IDENTITY", "PERSONA", "BIBLE"]);

export const WorkerTemplateSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Skill ids the role ships with, sorted. */
  skills: z.array(z.string()),
});

export const WorkerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  templateId: z.string(),
  workspacePath: z.string(),
  status: z.enum(["online", "offline"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkerTaskSummarySchema = z.object({
  taskId: z.string(),
  workerId: z.string(),
  title: z.string(),
  state: z.enum([
    "planned",
    "prepared",
    "assigned",
    "in_progress",
    "submitted",
    "completed",
    "revision",
    "blocked",
    "cancelled",
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkerTaskHistoryEntrySchema = z.object({
  seq: z.number().int().positive(),
  fromState: WorkerTaskSummarySchema.shape.state,
  toState: WorkerTaskSummarySchema.shape.state,
  action: z.string(),
  actor: z.string(),
  note: z.string(),
  recordedAt: z.string(),
});

export const GuardSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);

export const GuardFindingSchema = z.object({
  ruleId: z.string(),
  category: z.string(),
  severity: GuardSeveritySchema,
  description: z.string(),
  remediation: z.string(),
  matchedPattern: z.string(),
  snippet: z.string(),
});

export const GuardDecisionSchema = z.enum(["allow", "confirm", "block"]);

// ---------------------------------------------------------------- templates

export const WorkerTemplateListRequestSchema = z.object({
  type: z.literal("worker.template.list.request"),
  requestId: z.string(),
});

export const WorkerTemplateListResponseSchema = z.object({
  type: z.literal("worker.template.list.response"),
  payload: z.object({
    requestId: z.string(),
    templates: z.array(WorkerTemplateSummarySchema),
  }),
});

// ------------------------------------------------------------------ workers

export const WorkerListRequestSchema = z.object({
  type: z.literal("worker.worker.list.request"),
  requestId: z.string(),
});

export const WorkerListResponseSchema = z.object({
  type: z.literal("worker.worker.list.response"),
  payload: z.object({
    requestId: z.string(),
    workers: z.array(WorkerSummarySchema),
  }),
});

export const WorkerCreateRequestSchema = z.object({
  type: z.literal("worker.worker.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  templateId: z.string().min(1),
  /** Defaults to a daemon-managed directory when omitted. */
  workspacePath: z.string().min(1).optional(),
});

export const WorkerCreateResponseSchema = z.object({
  type: z.literal("worker.worker.create.response"),
  payload: z.object({
    requestId: z.string(),
    worker: WorkerSummarySchema,
  }),
});

export const WorkerGetRequestSchema = z.object({
  type: z.literal("worker.worker.get.request"),
  requestId: z.string(),
  workerId: z.string().min(1),
});

export const WorkerGetResponseSchema = z.object({
  type: z.literal("worker.worker.get.response"),
  payload: z.object({
    requestId: z.string(),
    worker: WorkerSummarySchema,
    tasks: z.array(WorkerTaskSummarySchema),
  }),
});

// -------------------------------------------------------------------- tasks

export const WorkerTaskCreateRequestSchema = z.object({
  type: z.literal("worker.task.create.request"),
  requestId: z.string(),
  workerId: z.string().min(1),
  title: z.string().min(1),
});

export const WorkerTaskCreateResponseSchema = z.object({
  type: z.literal("worker.task.create.response"),
  payload: z.object({
    requestId: z.string(),
    task: WorkerTaskSummarySchema,
  }),
});

export const WorkerTaskTransitionRequestSchema = z.object({
  type: z.literal("worker.task.transition.request"),
  requestId: z.string(),
  taskId: z.string().min(1),
  toState: WorkerTaskSummarySchema.shape.state,
  action: z.string().min(1),
  actor: z.string().min(1),
  note: z.string().optional(),
});

export const WorkerTaskTransitionResponseSchema = z.object({
  type: z.literal("worker.task.transition.response"),
  payload: z.object({
    requestId: z.string(),
    task: WorkerTaskSummarySchema,
  }),
});

export const WorkerTaskHistoryRequestSchema = z.object({
  type: z.literal("worker.task.history.request"),
  requestId: z.string(),
  taskId: z.string().min(1),
});

export const WorkerTaskHistoryResponseSchema = z.object({
  type: z.literal("worker.task.history.response"),
  payload: z.object({
    requestId: z.string(),
    taskId: z.string(),
    entries: z.array(WorkerTaskHistoryEntrySchema),
  }),
});

// ----------------------------------------------------------------- guard

/**
 * Dry-run a shell command against the guard without running it.
 *
 * Exposed because the alternative — letting the user find out by running it —
 * is exactly the outcome the guard exists to prevent.
 */
export const WorkerGuardEvaluateRequestSchema = z.object({
  type: z.literal("worker.guard.evaluate.request"),
  requestId: z.string(),
  command: z.string(),
  toolName: z.string().optional(),
});

export const WorkerGuardEvaluateResponseSchema = z.object({
  type: z.literal("worker.guard.evaluate.response"),
  payload: z.object({
    requestId: z.string(),
    decision: GuardDecisionSchema,
    maxSeverity: GuardSeveritySchema.nullable(),
    findings: z.array(GuardFindingSchema),
  }),
});
