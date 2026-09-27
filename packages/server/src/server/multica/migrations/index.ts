/**
 * The replica's migration sequence, in multica's apply order.
 *
 * Order matters and is pinned by test against the source directory's lexical
 * rule — the runner stays dumb, the ordering contract lives here.
 *
 * Gaps are deliberate and documented: a source migration that only touches
 * the multitenancy circle (or a circle we cut wholesale, like IM channels,
 * GitHub, plugins, cloud usage metering) is skipped by the baseline's cut
 * list, and its number stays absent so the sequence stays diffable against
 * the source directory.
 */
import { migration001Init } from "./001-init.js";
import {
  migration040AgentCustomEnv,
  migration046AgentUniqueName,
  migration050AgentModel,
  migration050IssueFirstExecutedAt,
  migration055TaskLeaseAndRetry,
  migration058DropAutopilotPriorityAndProjectId,
  migration059LabelTimestamps,
  migration060AgentDescriptionLength,
  migration060IssueOriginQuickCreate,
  migration061TaskTriggerSummary,
  migration066ForceFreshSession,
  migration069CommentResolvedAt,
  migration079AutopilotRunSkippedStatus,
  migration085SquadArchive,
  migration086SquadAvatar,
  migration087SquadNameNotUnique,
  migration088SquadInstructions,
} from "./040-088.js";
import {
  migration090TaskIsLeader,
  migration096AutopilotSquadAssignee,
  migration127TaskSquadId,
  migration509IssueWakeup,
} from "./090-509.js";
import {
  migration084Squad,
  migration332IssueStatus,
  migration333IssueStatusPkeyIndex,
  migration334IssueStatusPrimaryKey,
  migration335IssueStatusWorkspaceKeyIndex,
  migration336IssueStatusWorkspaceNameIndex,
  migration337IssueStatusOpenCheck,
  migration338IssueStatusValidateFormat,
  migration339SeedIssueStatusCatalog,
} from "./084-339.js";
import {
  migration002AgentConfig,
  migration004AgentRuntimeLoop,
  migration008StructuredSkills,
  migration015IssueSubscriber,
  migration017CommentParentId,
  migration018CommentParentCascade,
  migration020IssueNumber,
  migration026CommentReactions,
  migration027IssueReactions,
  migration029Attachment,
  migration032DropAgentTriggers,
  migration034Projects,
  migration041AgentCustomArgs,
  migration042Autopilot,
} from "./002-042.js";
import type { Migration } from "./runner.js";

export const MIGRATIONS: readonly Migration[] = [
  migration001Init,
  migration002AgentConfig,
  migration004AgentRuntimeLoop,
  migration008StructuredSkills,
  migration015IssueSubscriber,
  migration017CommentParentId,
  migration018CommentParentCascade,
  migration020IssueNumber,
  migration026CommentReactions,
  migration027IssueReactions,
  migration029Attachment,
  migration032DropAgentTriggers,
  migration034Projects,
  migration040AgentCustomEnv,
  migration041AgentCustomArgs,
  migration042Autopilot,
  migration046AgentUniqueName,
  migration050AgentModel,
  migration050IssueFirstExecutedAt,
  migration055TaskLeaseAndRetry,
  migration058DropAutopilotPriorityAndProjectId,
  migration059LabelTimestamps,
  migration060AgentDescriptionLength,
  migration060IssueOriginQuickCreate,
  migration061TaskTriggerSummary,
  migration066ForceFreshSession,
  migration069CommentResolvedAt,
  migration079AutopilotRunSkippedStatus,
  migration084Squad,
  migration085SquadArchive,
  migration086SquadAvatar,
  migration087SquadNameNotUnique,
  migration088SquadInstructions,
  migration090TaskIsLeader,
  migration096AutopilotSquadAssignee,
  migration127TaskSquadId,
  migration332IssueStatus,
  migration333IssueStatusPkeyIndex,
  migration334IssueStatusPrimaryKey,
  migration335IssueStatusWorkspaceKeyIndex,
  migration336IssueStatusWorkspaceNameIndex,
  migration337IssueStatusOpenCheck,
  migration338IssueStatusValidateFormat,
  migration339SeedIssueStatusCatalog,
  migration509IssueWakeup,
];
