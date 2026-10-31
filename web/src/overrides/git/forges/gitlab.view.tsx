// Override of packages/app/src/git/forges/gitlab.view.tsx: the GitLab brand, plus its merge-request
// contributions to the PR pane — the approvals badge in the header and the pipeline section in
// place of the checks list. Pipeline loading and job classification are the shared GitLab
// modules'; the view is DOM.
import { useCallback, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { CircleCheck, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CheckoutPipelineJob, CheckoutPipelineStage } from "@bytetrue/protocol/messages";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { COUNTED_CHECK_PRESENTATIONS } from "@/git/check-presentation";
import { CheckPresentationIcon } from "@/git/check-presentation.view";
import {
  definePaneContribution,
  type ClientForgeViewModule,
  type PaneChecksSlotContext,
} from "@/git/client-forge-module";
import {
  classifyGitlabPipelineJob,
  countGitlabPipelineJobs,
  deriveGitlabApprovals,
  deriveGitlabPipelineSummary,
  GitlabMergeFactsSchema,
  isPipelineActiveStatus,
  type GitlabApprovals,
  type GitlabMergeFacts,
  type GitlabPipelineSummary,
} from "@/git/forges/gitlab";
import {
  CheckPresentationSummaryPill,
  Section,
  sectionKitClassNames,
} from "@/git/pull-request-panel/section-kit";
import { useGitLabPipeline } from "@/git/pull-request-panel/use-pipeline";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatDuration } from "@/utils/time";
import { cn } from "cn";

function renderGitlabHeaderMeta(facts: GitlabMergeFacts): ReactNode {
  const approvals = deriveGitlabApprovals(facts);
  if (!approvals) {
    return null;
  }
  return <GitlabApprovalsBadge approvals={approvals} />;
}

function renderGitlabChecksSection(facts: GitlabMergeFacts, ctx: PaneChecksSlotContext): ReactNode {
  if (!ctx.enabled) {
    return null;
  }
  const summary = deriveGitlabPipelineSummary(facts);
  if (!summary) {
    return null;
  }
  return (
    <GitLabPipelineSection
      serverId={ctx.serverId}
      cwd={ctx.cwd}
      changeRequestNumber={ctx.changeRequestNumber}
      summary={summary}
      open={ctx.open}
      onToggle={ctx.onToggle}
      canFetchCheckDetails={ctx.canFetchCheckDetails}
    />
  );
}

function GitlabApprovalsBadge({ approvals }: { approvals: GitlabApprovals }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1" data-testid="pr-pane-approvals">
      <CircleCheck
        size={11}
        className={
          approvals.given >= approvals.required ? "text-status-success" : "text-muted-foreground"
        }
      />
      <span className="text-xs text-muted-foreground">
        {t("workspace.git.pr.approvals", { given: approvals.given, required: approvals.required })}
      </span>
    </span>
  );
}

function formatPipelineDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return "";
  }
  return formatDuration(seconds * 1000);
}

/** A row that opens a link when there is one; without a link it is plain. */
function LinkRow({
  url,
  className,
  testID,
  children,
}: {
  url: string | null | undefined;
  className: string;
  testID?: string;
  children: ReactNode;
}) {
  const open = useCallback(() => {
    if (url) void openExternalUrl(url);
  }, [url]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    },
    [open],
  );
  if (!url) {
    return (
      <div className={className} data-testid={testID}>
        {children}
      </div>
    );
  }
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={handleKeyDown}
      data-testid={testID}
      className={cn(className, "cursor-pointer outline-none hover:bg-card focus-visible:bg-card")}
    >
      {children}
    </div>
  );
}

function GitLabPipelineSection({
  serverId,
  cwd,
  changeRequestNumber,
  summary,
  open,
  onToggle,
  canFetchCheckDetails,
}: {
  serverId: string;
  cwd: string;
  changeRequestNumber: number;
  summary: GitlabPipelineSummary;
  open: boolean;
  onToggle: () => void;
  canFetchCheckDetails: boolean;
}) {
  const { t } = useTranslation();
  const { pipeline, isLoading, isPlaceholderData, error } = useGitLabPipeline({
    serverId,
    cwd,
    pipelineId: summary.id,
    changeRequestNumber,
    enabled: open && canFetchCheckDetails,
    live: isPipelineActiveStatus(summary.rawStatus),
  });

  const counts = useMemo(
    () => countGitlabPipelineJobs((pipeline?.stages ?? []).flatMap((stage) => stage.jobs)),
    [pipeline],
  );

  const totalCounted = Object.values(counts).reduce((total, count) => total + count, 0);
  const showBreakdown = !isPlaceholderData && totalCounted > 0;
  const displayCounts = showBreakdown ? counts : countGitlabPipelineJobs([]);

  const sectionSummary = (
    <>
      {COUNTED_CHECK_PRESENTATIONS.map((presentation) => (
        <CheckPresentationSummaryPill
          key={presentation}
          count={displayCounts[presentation]}
          presentation={presentation}
          testID={`pr-pane-pipeline-${presentation}`}
        />
      ))}
      {showBreakdown ? null : <GitLabPipelineStatusIcon status={summary.rawStatus} />}
    </>
  );

  return (
    <Section
      title={t("workspace.git.pr.sections.pipeline")}
      open={open}
      onToggle={onToggle}
      summary={sectionSummary}
    >
      <LinkRow
        url={summary.url}
        className={sectionKitClassNames.checkRow}
        testID="pr-pane-pipeline-link"
      >
        <GitLabPipelineStatusIcon status={summary.rawStatus} />
        <span className={sectionKitClassNames.checkName}>{`Pipeline #${summary.id}`}</span>
        {summary.rawStatus ? (
          <span className={sectionKitClassNames.checkWorkflow}>{summary.rawStatus}</span>
        ) : null}
        {summary.url ? (
          <span className={sectionKitClassNames.checkTrailing}>
            <ExternalLink size={12} className="text-muted-foreground" />
          </span>
        ) : null}
      </LinkRow>
      {isLoading ? (
        <p className={sectionKitClassNames.emptyText}>
          {t("workspace.git.pr.empty.loadingPipeline")}
        </p>
      ) : null}
      {!isLoading && pipeline && pipeline.stages.length === 0 ? (
        <p className={sectionKitClassNames.emptyText}>{t("workspace.git.pr.empty.noJobs")}</p>
      ) : null}
      {!isLoading && pipeline && pipeline.stages.length > 0
        ? pipeline.stages.map((stage) => <PipelineStageGroup key={stage.name} stage={stage} />)
        : null}
      {!isLoading && !pipeline && error ? (
        <p className={sectionKitClassNames.emptyText}>
          {t("workspace.git.pr.empty.pipelineJobsLoadFailed")}
        </p>
      ) : null}
    </Section>
  );
}

function PipelineStageGroup({ stage }: { stage: CheckoutPipelineStage }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <GitLabPipelineStatusIcon status={stage.status} />
        <span className="min-w-0 truncate text-xs font-medium tracking-[0.5px] text-muted-foreground uppercase">
          {stage.name}
        </span>
      </div>
      {stage.jobs.map((job) => (
        <PipelineJobRow key={job.id} job={job} />
      ))}
    </div>
  );
}

function PipelineJobRow({ job }: { job: CheckoutPipelineJob }) {
  const { t } = useTranslation();
  const duration = formatPipelineDuration(job.durationSeconds);
  return (
    <LinkRow url={job.url} className="flex min-h-8 items-center gap-2 py-2 pr-3 pl-6">
      <GitLabPipelineStatusIcon status={job.status} allowFailure={job.allowFailure} />
      <span className={sectionKitClassNames.checkName}>{job.name}</span>
      {job.allowFailure ? (
        <span className={sectionKitClassNames.checkWorkflow}>
          {t("workspace.git.pr.empty.allowedToFail")}
        </span>
      ) : null}
      <span className={sectionKitClassNames.checkTrailing}>
        {duration ? <span className={sectionKitClassNames.checkDuration}>{duration}</span> : null}
      </span>
    </LinkRow>
  );
}

function GitLabPipelineStatusIcon({
  status,
  allowFailure = false,
}: {
  status: string;
  allowFailure?: boolean;
}) {
  const presentation = classifyGitlabPipelineJob({ status, allowFailure });
  return <CheckPresentationIcon presentation={presentation} size={14} />;
}

export const gitlabForgeView = {
  id: "gitlab",
  icon: GitLabIcon,
  brandColor: {
    light: "#FC6D26",
    dark: "#FC6D26",
  },
  paneContributions: [
    definePaneContribution(GitlabMergeFactsSchema, {
      renderHeaderMeta: renderGitlabHeaderMeta,
      renderChecksSection: renderGitlabChecksSection,
    }),
  ],
} satisfies ClientForgeViewModule;
