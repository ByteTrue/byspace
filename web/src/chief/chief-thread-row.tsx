import type {
  ChiefMergeDryRunResult,
  ChiefSystemAttention,
  ChiefThreadSnapshot,
  ChiefThreadStatus,
  ChiefVerifyVerdict,
} from "@bytetrue/protocol/messages";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import { hasActiveSystemAttention } from "@/stores/chief-store";
import { cn } from "cn";
import { ArrowUpRight, CircleAlert, GitBranch, TriangleAlert } from "lucide-react";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

type WorkerAgentStatus = ChiefThreadSnapshot["authorAgentStatus"];

export type ChiefThreadOperation = "mergeCheck" | "land" | "cancel";

export interface ChiefThreadRowProps {
  thread: ChiefThreadSnapshot;
  pendingOperation: ChiefThreadOperation | null;
  error: string | null;
  onOpenAgent: (agentId: string, workspaceId?: string | null) => void;
  onRunOperation: (thread: ChiefThreadSnapshot, operation: ChiefThreadOperation) => void;
}

const THREAD_STATUS_TONE: Record<ChiefThreadStatus, string> = {
  queued: "text-muted-foreground",
  authoring: "text-foreground",
  verifying: "text-status-warning",
  needs_rebase: "text-status-warning",
  merge_checking: "text-status-warning",
  ready_to_land: "text-status-success",
  landed: "text-status-merged",
  blocked: "text-status-danger",
  failed: "text-status-danger",
  canceled: "text-muted-foreground",
};

const TERMINAL_THREAD_STATUSES: ReadonlySet<ChiefThreadStatus> = new Set([
  "landed",
  "failed",
  "canceled",
]);

function workerStatusDotClass(status: WorkerAgentStatus): string {
  if (status === "running" || status === "initializing") {
    return "bg-status-dot-running";
  }
  if (status === "error") {
    return "bg-status-dot-danger";
  }
  if (status === "idle") {
    return "bg-status-dot-success";
  }
  return "bg-muted-foreground/50";
}

function WorkerAgentLinkButton({
  agentId,
  workspaceId,
  roleLabel,
  status,
  tierLabel,
  testId,
  onOpenAgent,
}: {
  agentId: string;
  workspaceId?: string | null;
  roleLabel: string;
  status?: WorkerAgentStatus;
  tierLabel?: string | null;
  testId: string;
  onOpenAgent: (agentId: string, workspaceId?: string | null) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    onOpenAgent(agentId, workspaceId);
  }, [agentId, onOpenAgent, workspaceId]);

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={handlePress}
      data-testid={testId}
      className="gap-1.5"
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", workerStatusDotClass(status))} />
      <span>{roleLabel}</span>
      {tierLabel ? <span className="text-muted-foreground">· {tierLabel}</span> : null}
      <ArrowUpRight data-icon="inline-end" />
    </Button>
  );
}

function ThreadAttentionStrip({
  attention,
  workspaceId,
  onOpenAgent,
}: {
  attention: ChiefSystemAttention;
  workspaceId?: string | null;
  onOpenAgent: (agentId: string, workspaceId?: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isFatal = attention.severity === "fatal";
  const Icon = isFatal ? CircleAlert : TriangleAlert;
  const attentionAgentId = attention.agentId?.trim() || null;

  const handleOpenAttentionAgent = useCallback(() => {
    if (attentionAgentId) {
      onOpenAgent(attentionAgentId, workspaceId);
    }
  }, [attentionAgentId, onOpenAgent, workspaceId]);

  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-2 rounded-md border px-2.5 py-2 text-xs",
        isFatal ? "border-destructive/40 text-status-danger" : "border-border text-status-warning",
      )}
      data-testid={`chief-thread-attention-${attention.kind}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5 font-medium">
            <span>{t(`chief.attention.kinds.${attention.kind}`)}</span>
            {attention.autoActionTaken ? (
              <span className="font-normal text-muted-foreground">
                · {attention.autoActionTaken}
              </span>
            ) : null}
          </div>
          <p className="text-foreground">{attention.summary}</p>
        </div>
      </div>
      {attentionAgentId ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={handleOpenAttentionAgent}
          data-testid="chief-thread-attention-open-agent"
        >
          {t("chief.actions.openConversation")}
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      ) : null}
    </div>
  );
}

function ThreadMetaLine({ thread }: { thread: ChiefThreadSnapshot }): ReactElement | null {
  const { t } = useTranslation();
  const hasPaths = thread.ownedPaths.length > 0;
  const hasRejects = thread.verifyRejectCount > 0;
  const hasRebases = thread.rebaseAttempts > 0;

  if (!hasPaths && !hasRejects && !hasRebases) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {hasPaths ? (
        <span className="truncate" title={thread.ownedPaths.join(", ")}>
          {t("chief.thread.ownedPaths", {
            paths: thread.ownedPaths.slice(0, 3).join(", "),
            extra: thread.ownedPaths.length > 3 ? ` (+${thread.ownedPaths.length - 3})` : "",
          })}
        </span>
      ) : null}
      {hasRejects ? (
        <span>{t("chief.thread.rejectCount", { count: thread.verifyRejectCount })}</span>
      ) : null}
      {hasRebases ? (
        <span>{t("chief.thread.rebaseCount", { count: thread.rebaseAttempts })}</span>
      ) : null}
    </div>
  );
}

function ThreadVerdictStrip({
  threadId,
  verdict,
}: {
  threadId: string;
  verdict: ChiefVerifyVerdict;
}): ReactElement {
  const { t } = useTranslation();
  const isPass = verdict.outcome === "pass";

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs"
      data-testid={`chief-thread-verdict-${threadId}`}
    >
      <Badge variant="secondary" className={isPass ? "text-status-success" : "text-status-danger"}>
        {isPass ? t("chief.verdict.pass") : t("chief.verdict.reject")}
      </Badge>
      {verdict.tainted ? (
        <Badge variant="secondary" className="text-status-danger">
          {t("chief.verdict.tainted")}
        </Badge>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-foreground">{verdict.summary}</span>
    </div>
  );
}

function ThreadMergeConflictNotice({
  threadId,
  mergeCheck,
}: {
  threadId: string;
  mergeCheck: ChiefMergeDryRunResult;
}): ReactElement | null {
  const { t } = useTranslation();
  if (mergeCheck.clean) {
    return null;
  }
  const files = (mergeCheck.conflictingFiles ?? []).slice(0, 3).join(", ");
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-xs text-status-warning"
      data-testid={`chief-thread-merge-conflict-${threadId}`}
    >
      <TriangleAlert className="size-3.5 shrink-0" />
      <span>
        {mergeCheck.dirtyWorktree
          ? t("chief.mergeCheck.dirtyWorktree")
          : t("chief.mergeCheck.conflict", { files })}
      </span>
    </div>
  );
}

function ThreadWorkerLinks({
  thread,
  onOpenAgent,
}: {
  thread: ChiefThreadSnapshot;
  onOpenAgent: (agentId: string, workspaceId?: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const authorTierLabel = thread.authorTier
    ? t(`settings.host.agentProfiles.tiers.${thread.authorTier}`)
    : null;
  const verifierTierLabel = thread.verifierTier
    ? t(`settings.host.agentProfiles.tiers.${thread.verifierTier}`)
    : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {thread.authorAgentId ? (
        <WorkerAgentLinkButton
          agentId={thread.authorAgentId}
          workspaceId={thread.workspaceId}
          roleLabel={t("chief.roles.author")}
          status={thread.authorAgentStatus}
          tierLabel={authorTierLabel}
          testId={`chief-thread-open-author-${thread.id}`}
          onOpenAgent={onOpenAgent}
        />
      ) : null}
      {thread.verifierAgentId ? (
        <WorkerAgentLinkButton
          agentId={thread.verifierAgentId}
          workspaceId={thread.workspaceId}
          roleLabel={t("chief.roles.verifier")}
          status={thread.verifierAgentStatus}
          tierLabel={verifierTierLabel}
          testId={`chief-thread-open-verifier-${thread.id}`}
          onOpenAgent={onOpenAgent}
        />
      ) : null}
      {thread.integratorAgentId ? (
        <WorkerAgentLinkButton
          agentId={thread.integratorAgentId}
          workspaceId={thread.workspaceId}
          roleLabel={t("chief.roles.integrator")}
          status={thread.integratorAgentStatus}
          testId={`chief-thread-open-integrator-${thread.id}`}
          onOpenAgent={onOpenAgent}
        />
      ) : null}
    </div>
  );
}

export function ChiefThreadRow({
  thread,
  pendingOperation,
  error,
  onOpenAgent,
  onRunOperation,
}: ChiefThreadRowProps): ReactElement {
  const { t } = useTranslation();
  const statusToneClass = THREAD_STATUS_TONE[thread.status];
  const activeAttention = hasActiveSystemAttention(thread.systemAttention)
    ? thread.systemAttention
    : null;
  const canCancel = !TERMINAL_THREAD_STATUSES.has(thread.status);
  const handleMergeCheck = useCallback(
    () => onRunOperation(thread, "mergeCheck"),
    [onRunOperation, thread],
  );
  const handleLand = useCallback(() => onRunOperation(thread, "land"), [onRunOperation, thread]);
  const handleCancel = useCallback(
    () => onRunOperation(thread, "cancel"),
    [onRunOperation, thread],
  );

  return (
    <Item
      variant="outline"
      size="sm"
      className="flex-col items-stretch gap-2"
      data-testid={`chief-thread-row-${thread.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ItemContent className="min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <ItemTitle className="truncate">{thread.title}</ItemTitle>
            <Badge
              variant="secondary"
              className={statusToneClass}
              data-testid={`chief-thread-status-${thread.id}`}
            >
              {t(`chief.threadStatus.${thread.status}`)}
            </Badge>
            <Badge variant="outline">{t(`chief.isolation.${thread.isolation}`)}</Badge>
            {thread.branch ? (
              <span className="inline-flex max-w-[200px] items-center gap-1 truncate text-xs text-muted-foreground">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate">{thread.branch}</span>
              </span>
            ) : null}
          </div>
          <ItemDescription className="line-clamp-2 text-foreground">{thread.goal}</ItemDescription>
        </ItemContent>
      </div>

      <ThreadMetaLine thread={thread} />

      {activeAttention ? (
        <ThreadAttentionStrip
          attention={activeAttention}
          workspaceId={thread.workspaceId}
          onOpenAgent={onOpenAgent}
        />
      ) : null}

      {thread.lastVerdict ? (
        <ThreadVerdictStrip threadId={thread.id} verdict={thread.lastVerdict} />
      ) : null}

      {thread.mergeCheck ? (
        <ThreadMergeConflictNotice threadId={thread.id} mergeCheck={thread.mergeCheck} />
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 px-2.5 py-2 text-xs text-status-danger"
          data-testid={"chief-thread-error-" + thread.id}
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{t("chief.errors.threadActionFailed")}</span>
            <p className="text-foreground">{error}</p>
          </div>
        </div>
      ) : null}

      {canCancel ? (
        <div
          className="flex flex-wrap items-center gap-1.5 border-t pt-2"
          aria-busy={pendingOperation !== null}
        >
          {thread.status === "ready_to_land" ||
          thread.status === "merge_checking" ||
          thread.status === "needs_rebase" ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pendingOperation !== null}
              onClick={handleMergeCheck}
              data-testid={"chief-thread-recheck-" + thread.id}
            >
              {pendingOperation === "mergeCheck" ? <Spinner data-icon="inline-start" /> : null}
              {t("chief.actions.recheck")}
            </Button>
          ) : null}
          {thread.status === "ready_to_land" ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pendingOperation !== null}
              onClick={handleLand}
              data-testid={"chief-thread-land-" + thread.id}
            >
              {pendingOperation === "land" ? <Spinner data-icon="inline-start" /> : null}
              {t("chief.actions.land")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-status-danger"
            disabled={pendingOperation !== null}
            onClick={handleCancel}
            data-testid={"chief-thread-cancel-" + thread.id}
          >
            {pendingOperation === "cancel" ? <Spinner data-icon="inline-start" /> : null}
            {t("chief.actions.cancelThread")}
          </Button>
        </div>
      ) : null}

      <ThreadWorkerLinks thread={thread} onOpenAgent={onOpenAgent} />
    </Item>
  );
}
