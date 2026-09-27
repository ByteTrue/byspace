/**
 * Wire schemas for the multica replica's RPC surface.
 *
 * One domain directory mirroring the repo's per-domain rpc-schemas pattern:
 * requests and responses in pairs, dotted namespace with direction suffixes.
 * The first slice covers the read/write core the console and the CLI need —
 * agent/issue/comment/squad/task list, create, get — shaped to match the
 * store's rows so the handler is a thin translation.
 *
 * Wire types deliberately stay flat: the JSON columns (metadata, properties,
 * context, runtime_config) travel as their TEXT wire form and are parsed by
 * the reader, per the translation rules.
 */
import { z } from "zod";

// ---------------------------------------------------------------- agents

export const MulticaAgentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  status: z.string(),
  description: z.string(),
  instructions: z.string(),
  kind: z.string(),
  systemKey: z.string().nullable(),
  permissionMode: z.string(),
  maxConcurrentTasks: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});

export const MulticaAgentListRequestSchema = z.object({
  type: z.literal("multica.agent.list.request"),
  requestId: z.string(),
  includeArchived: z.boolean().optional(),
});

export const MulticaAgentListResponseSchema = z.object({
  type: z.literal("multica.agent.list.response"),
  payload: z.object({
    requestId: z.string(),
    agents: z.array(MulticaAgentSummarySchema),
  }),
});

export const MulticaAgentCreateRequestSchema = z.object({
  type: z.literal("multica.agent.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  description: z.string().max(255).optional(),
  instructions: z.string().optional(),
});

export const MulticaAgentCreateResponseSchema = z.object({
  type: z.literal("multica.agent.create.response"),
  payload: z.object({
    requestId: z.string(),
    agent: MulticaAgentSummarySchema,
  }),
});

// ---------------------------------------------------------------- issues

export const MulticaIssueSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  assigneeType: z.string().nullable(),
  assigneeId: z.string().nullable(),
  creatorType: z.string(),
  creatorId: z.string(),
  number: z.number().int().nullable(),
  projectId: z.string().nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().nullable(),
});

export const MulticaIssueListRequestSchema = z.object({
  type: z.literal("multica.issue.list.request"),
  requestId: z.string(),
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
});

export const MulticaIssueListResponseSchema = z.object({
  type: z.literal("multica.issue.list.response"),
  payload: z.object({
    requestId: z.string(),
    issues: z.array(MulticaIssueSummarySchema),
  }),
});

export const MulticaIssueCreateRequestSchema = z.object({
  type: z.literal("multica.issue.create.request"),
  requestId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeType: z.string().optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
});

export const MulticaIssueCreateResponseSchema = z.object({
  type: z.literal("multica.issue.create.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
  }),
});

export const MulticaIssueGetRequestSchema = z.object({
  type: z.literal("multica.issue.get.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});

export const MulticaIssueGetResponseSchema = z.object({
  type: z.literal("multica.issue.get.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
  }),
});

export const MulticaIssueStatusUpdateRequestSchema = z.object({
  type: z.literal("multica.issue.status.update.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  status: z.string().min(1),
  /** The revision the caller read — optimistic concurrency. */
  expectedRevision: z.number().int().positive(),
});

export const MulticaIssueStatusUpdateResponseSchema = z.object({
  type: z.literal("multica.issue.status.update.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
  }),
});

// ---------------------------------------------------------------- comments

export const MulticaCommentSummarySchema = z.object({
  id: z.string(),
  issueId: z.string(),
  authorType: z.string(),
  authorId: z.string(),
  content: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int(),
  sourceTaskId: z.string().nullable(),
});

export const MulticaCommentListRequestSchema = z.object({
  type: z.literal("multica.comment.list.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});

export const MulticaCommentListResponseSchema = z.object({
  type: z.literal("multica.comment.list.response"),
  payload: z.object({
    requestId: z.string(),
    comments: z.array(MulticaCommentSummarySchema),
  }),
});

export const MulticaCommentCreateRequestSchema = z.object({
  type: z.literal("multica.comment.create.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  content: z.string().min(1),
  parentId: z.string().optional(),
});

export const MulticaCommentCreateResponseSchema = z.object({
  type: z.literal("multica.comment.create.response"),
  payload: z.object({
    requestId: z.string(),
    comment: MulticaCommentSummarySchema,
  }),
});

export const MulticaStatusSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  category: z.string(),
  color: z.string(),
  isSystem: z.boolean(),
  position: z.number(),
});

export const MulticaStatusListRequestSchema = z.object({
  type: z.literal("multica.status.list.request"),
  requestId: z.string(),
});

export const MulticaStatusListResponseSchema = z.object({
  type: z.literal("multica.status.list.response"),
  payload: z.object({
    requestId: z.string(),
    statuses: z.array(MulticaStatusSummarySchema),
  }),
});

export const MulticaIssueUpdateRequestSchema = z.object({
  type: z.literal("multica.issue.update.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
  /** The revision the caller read — optimistic concurrency. */
  expectedRevision: z.number().int().positive(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeType: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
});

export const MulticaIssueUpdateResponseSchema = z.object({
  type: z.literal("multica.issue.update.response"),
  payload: z.object({
    requestId: z.string(),
    issue: MulticaIssueSummarySchema,
  }),
});

// ---------------------------------------------------------------- squads

export const MulticaSquadSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  leaderId: z.string(),
  instructions: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MulticaSquadMemberSummarySchema = z.object({
  id: z.string(),
  squadId: z.string(),
  memberType: z.string(),
  memberId: z.string(),
  role: z.string(),
});

export const MulticaSquadListRequestSchema = z.object({
  type: z.literal("multica.squad.list.request"),
  requestId: z.string(),
});

export const MulticaSquadListResponseSchema = z.object({
  type: z.literal("multica.squad.list.response"),
  payload: z.object({
    requestId: z.string(),
    squads: z.array(MulticaSquadSummarySchema),
  }),
});

export const MulticaSquadCreateRequestSchema = z.object({
  type: z.literal("multica.squad.create.request"),
  requestId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  leaderId: z.string().min(1),
  members: z
    .array(z.object({ memberType: z.enum(["agent", "owner"]), memberId: z.string() }))
    .optional(),
});

export const MulticaSquadCreateResponseSchema = z.object({
  type: z.literal("multica.squad.create.response"),
  payload: z.object({
    requestId: z.string(),
    squad: MulticaSquadSummarySchema,
    members: z.array(MulticaSquadMemberSummarySchema),
  }),
});

// ---------------------------------------------------------------- tasks

export const MulticaTaskSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  issueId: z.string(),
  status: z.string(),
  isLeaderTask: z.boolean(),
  squadId: z.string().nullable(),
  triggerCommentId: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const MulticaTaskRunningListRequestSchema = z.object({
  type: z.literal("multica.task.running.list.request"),
  requestId: z.string(),
});

export const MulticaTaskRunningListResponseSchema = z.object({
  type: z.literal("multica.task.running.list.response"),
  payload: z.object({
    requestId: z.string(),
    tasks: z.array(MulticaTaskSummarySchema),
  }),
});

export const MulticaTaskListRequestSchema = z.object({
  type: z.literal("multica.task.list.request"),
  requestId: z.string(),
  issueId: z.string().min(1),
});

export const MulticaTaskListResponseSchema = z.object({
  type: z.literal("multica.task.list.response"),
  payload: z.object({
    requestId: z.string(),
    tasks: z.array(MulticaTaskSummarySchema),
  }),
});

// ------------------------------------------------------------ inferred types

export type MulticaAgentSummary = z.infer<typeof MulticaAgentSummarySchema>;
export type MulticaIssueSummary = z.infer<typeof MulticaIssueSummarySchema>;
export type MulticaCommentSummary = z.infer<typeof MulticaCommentSummarySchema>;
export type MulticaSquadSummary = z.infer<typeof MulticaSquadSummarySchema>;
export type MulticaSquadMemberSummary = z.infer<typeof MulticaSquadMemberSummarySchema>;
export type MulticaStatusSummary = z.infer<typeof MulticaStatusSummarySchema>;
export type MulticaTaskSummary = z.infer<typeof MulticaTaskSummarySchema>;
