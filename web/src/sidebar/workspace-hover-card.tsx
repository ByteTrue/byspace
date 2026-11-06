import { Separator } from "~/components/ui/separator";
import * as Clipboard from "~/lib/clipboard";
import { Button } from "~/components/ui/button";
import { useCallback, useState, type ComponentType, type ReactElement } from "react";
import { Check, Copy, ExternalLink, FileDiff, Folder, GitBranch, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { AgentLifecycleStatus } from "@bytetrue/protocol/agent-lifecycle";
import {
  COUNTED_CHECK_PRESENTATIONS,
  countCheckPresentations,
  type CountedCheckPresentation,
} from "@/git/check-presentation";
import { formatCheckPresentationCountsLabel } from "@/git/check-presentation-copy";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import { buildForgeChecksUrl } from "@/git/forge-url";
import type { PrHint } from "@/git/pr-hint";
import { selectWorkspaceAgents } from "@/hooks/sidebar-workspaces-view-model";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { openExternalUrl } from "@/utils/open-external-url";
import { cn } from "cn";
import { AgentStatusDot } from "~/components/agent-status-dot";
import {
  CHECK_TONE_CLASS,
  CheckPresentationIcon,
  getCheckPresentationTone,
} from "~/components/check-presentation";
import { ForgeIcon } from "~/components/forge-icon";
import {
  InfoHoverCard,
  InfoHoverCardContent,
  InfoHoverCardTrigger,
} from "~/components/info-hover-card";
import { DiffStat, PullRequestStateIcon } from "~/sidebar/meta-row";

// Geometry follows archive/expo-app:packages/app/src/components/workspace-hover-card.tsx: a 260px card, 12px
// info rows on a 12px rail, 12px icons, separators between the sections.

const AGENT_STATUS_LABEL_KEYS = {
  initializing: "agentList.status.initializing",
  idle: "agentList.status.idle",
  running: "agentList.status.running",
  error: "agentList.status.error",
  closed: "agentList.status.closed",
} as const satisfies Record<AgentLifecycleStatus, string>;

const INFO_ROW = "flex min-w-0 items-center gap-1.5 px-3 pb-2 text-xs";
const INFO_ICON = "size-3 shrink-0";
type InfoIcon = ComponentType<{ className?: string }>;

function InfoRow({ icon: Icon, value, testId }: { icon: InfoIcon; value: string; testId: string }) {
  return (
    <div className={cn(INFO_ROW, "text-muted-foreground")}>
      <Icon className={INFO_ICON} />
      <span className="min-w-0 flex-1 truncate" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** Copies its value on click; the icon turns into Copy on hover and Check for two seconds after. */
function CopyableInfoRow({
  icon: Icon,
  value,
  copyValue,
  copyLabel,
  testId,
}: {
  icon: InfoIcon;
  value: string;
  copyValue: string;
  copyLabel: string;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void Clipboard.writeText(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copyValue]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={copyLabel}
      onClick={copy}
      data-copied={copied || undefined}
      className="group/copy w-full justify-start"
    >
      {copied ? (
        <Check className={INFO_ICON} />
      ) : (
        <>
          <Icon className={cn(INFO_ICON, "group-hover/copy:hidden")} />
          <Copy className={cn(INFO_ICON, "hidden group-hover/copy:block")} />
        </>
      )}
      <span className="min-w-0 flex-1 truncate text-left" data-testid={testId}>
        {value}
      </span>
    </Button>
  );
}

/** The Expo app's PrBadge on the info-row rail: state icon (external link on hover) and number. */
function PrRow({ hint }: { hint: PrHint }) {
  const { t } = useTranslation();
  const openPullRequest = useCallback(() => void openExternalUrl(hint.url), [hint.url]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={openPullRequest}
      aria-label={t("workspace.git.pr.accessibility.pullRequest", {
        number: hint.number,
        context: getForgePresentation(normalizeForge(hint.forge)).changeRequestContext,
      })}
      className="group/pr w-full justify-start"
    >
      <PullRequestStateIcon state={hint.state} className="group-hover/pr:hidden" />
      <ExternalLink className={cn(INFO_ICON, "hidden group-hover/pr:block")} />
      <span className="truncate">{hint.number}</span>
    </Button>
  );
}

function ChecksPill({
  count,
  presentation,
}: {
  count: number;
  presentation: CountedCheckPresentation;
}) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-[3px]">
      <CheckPresentationIcon presentation={presentation} />
      <span className={CHECK_TONE_CLASS[getCheckPresentationTone(presentation)]}>{count}</span>
    </span>
  );
}

function ChecksSummary({
  checks,
  forge,
  url,
}: {
  checks: NonNullable<PrHint["checks"]>;
  forge: PrHint["forge"];
  url: string;
}) {
  const { t } = useTranslation();
  const counts = countCheckPresentations(checks);
  const icon = getForgePresentation(normalizeForge(forge)).icon;
  const openChecks = useCallback(
    () => void openExternalUrl(buildForgeChecksUrl(forge, url) ?? url),
    [forge, url],
  );
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={formatCheckPresentationCountsLabel(
        counts,
        t("workspace.git.pr.sections.checks"),
        t,
      )}
      onClick={openChecks}
      className="group/checks w-full justify-start"
    >
      <ForgeIcon iconKind={icon} className="group-hover/checks:hidden" />
      <ExternalLink className={cn(INFO_ICON, "hidden group-hover/checks:block")} />
      <span>{t("workspace.git.pr.sections.checks")}</span>
      <span className="flex flex-1 items-center justify-end gap-2">
        {COUNTED_CHECK_PRESENTATIONS.map((presentation) => (
          <ChecksPill key={presentation} count={counts[presentation]} presentation={presentation} />
        ))}
      </span>
    </Button>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const key = `${agent.serverId}:${agent.id}`;
  return (
    <div className="flex items-center gap-1.5" data-testid={`hover-card-agent-${key}`}>
      <span className="flex w-2 shrink-0 justify-center">
        <AgentStatusDot
          status={agent.status}
          requiresAttention={agent.requiresAttention}
          attentionReason={agent.attentionReason}
          pendingPermissionCount={agent.pendingPermissions.length}
          showInactive
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-xs">
        <span className="truncate" data-testid={`hover-card-agent-title-${key}`}>
          {agent.title || t("agentList.fallbackTitle")}
        </span>
        <span
          className="truncate text-muted-foreground"
          data-testid={`hover-card-agent-status-${key}`}
        >
          {t(AGENT_STATUS_LABEL_KEYS[agent.status])}
        </span>
      </span>
    </div>
  );
}

function HoverCardBody({ workspace }: { workspace: SidebarWorkspaceEntry }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const hostLabel =
    hosts.find((host) => host.serverId === workspace.serverId)?.label?.trim() || workspace.serverId;
  const agents = useSessionStore(
    useShallow((state) =>
      selectWorkspaceAgents({
        agents: state.sessions[workspace.serverId]?.agents,
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
      }),
    ),
  );
  const prHint = workspace.prHint;
  return (
    <>
      <div className="flex items-center gap-2 px-3 pb-2">
        <p
          className="min-w-0 flex-1 text-sm leading-[normal]"
          data-testid="hover-card-workspace-name"
        >
          {workspace.name}
        </p>
      </div>
      {prHint ? <PrRow hint={prHint} /> : null}
      {workspace.diffStat ? (
        <div className={cn(INFO_ROW, "text-muted-foreground")}>
          <FileDiff className={INFO_ICON} />
          <DiffStat
            additions={workspace.diffStat.additions}
            deletions={workspace.diffStat.deletions}
          />
        </div>
      ) : null}
      <InfoRow icon={Server} value={hostLabel} testId="hover-card-workspace-host" />
      {workspace.currentBranch ? (
        <CopyableInfoRow
          icon={GitBranch}
          value={workspace.currentBranch}
          copyValue={workspace.currentBranch}
          copyLabel={t("workspace.hoverCard.copyBranchName")}
          testId="hover-card-workspace-branch"
        />
      ) : null}
      {workspace.workspaceDirectoryLabel ? (
        <CopyableInfoRow
          icon={Folder}
          value={workspace.workspaceDirectoryLabel}
          copyValue={workspace.workspaceDirectory}
          copyLabel={t("workspace.hoverCard.copyPath")}
          testId="hover-card-workspace-cwd"
        />
      ) : null}
      {prHint?.checks && prHint.checks.length > 0 ? (
        <>
          <Separator />
          <ChecksSummary checks={prHint.checks} forge={prHint.forge} url={prHint.url} />
        </>
      ) : null}
      {agents.length > 0 ? (
        <>
          <Separator />
          <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto px-3 py-2">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export function WorkspaceHoverCard({
  workspace,
  disabled = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <InfoHoverCard disabled={disabled}>
      <InfoHoverCardTrigger>{children}</InfoHoverCardTrigger>
      <InfoHoverCardContent
        side="right"
        align="start"
        className="p-0 pt-2"
        data-testid="workspace-hover-card"
      >
        <HoverCardBody workspace={workspace} />
      </InfoHoverCardContent>
    </InfoHoverCard>
  );
}
