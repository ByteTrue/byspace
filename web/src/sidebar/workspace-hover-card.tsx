import * as Clipboard from "expo-clipboard";
import {
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type FocusEvent,
  type ReactElement,
} from "react";
import { Check, Copy, ExternalLink, FileDiff, Folder, GitBranch, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { AgentLifecycleStatus } from "@bytetrue/protocol/agent-lifecycle";
import { useIsCompactFormFactor } from "@/constants/layout";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { DiffStat, PullRequestStateIcon } from "~/sidebar/meta-row";

// Geometry follows packages/app/src/components/workspace-hover-card.tsx: a 260px card, 12px
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
    void Clipboard.setStringAsync(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copyValue]);
  return (
    <button
      type="button"
      aria-label={copyLabel}
      onClick={copy}
      data-copied={copied || undefined}
      className={cn(
        INFO_ROW,
        "group/copy w-full text-left text-muted-foreground hover:text-foreground data-copied:text-foreground",
      )}
    >
      {copied ? (
        <Check className={INFO_ICON} />
      ) : (
        <>
          <Icon className={cn(INFO_ICON, "group-hover/copy:hidden")} />
          <Copy className={cn(INFO_ICON, "hidden group-hover/copy:block")} />
        </>
      )}
      <span className="min-w-0 flex-1 truncate" data-testid={testId}>
        {value}
      </span>
    </button>
  );
}

/** packages/app's PrBadge on the info-row rail: state icon (external link on hover) and number. */
function PrRow({ hint }: { hint: PrHint }) {
  const { t } = useTranslation();
  const openPullRequest = useCallback(() => void openExternalUrl(hint.url), [hint.url]);
  return (
    <button
      type="button"
      onClick={openPullRequest}
      aria-label={t("workspace.git.pr.accessibility.pullRequest", {
        number: hint.number,
        context: getForgePresentation(normalizeForge(hint.forge)).changeRequestContext,
      })}
      className={cn(
        INFO_ROW,
        "group/pr w-full text-left text-muted-foreground hover:text-foreground",
      )}
    >
      <PullRequestStateIcon state={hint.state} className="group-hover/pr:hidden" />
      <ExternalLink className={cn(INFO_ICON, "hidden group-hover/pr:block")} />
      <span className="truncate">{hint.number}</span>
    </button>
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
    <button
      type="button"
      aria-label={formatCheckPresentationCountsLabel(
        counts,
        t("workspace.git.pr.sections.checks"),
        t,
      )}
      onClick={openChecks}
      className="group/checks flex min-h-7 w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
    >
      <ForgeIcon iconKind={icon} className="group-hover/checks:hidden" />
      <ExternalLink className={cn(INFO_ICON, "hidden group-hover/checks:block")} />
      <span>{t("workspace.git.pr.sections.checks")}</span>
      <span className="flex flex-1 items-center justify-end gap-2">
        {COUNTED_CHECK_PRESENTATIONS.map((presentation) => (
          <ChecksPill key={presentation} count={counts[presentation]} presentation={presentation} />
        ))}
      </span>
    </button>
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
          <div className="h-px bg-border" />
          <ChecksSummary checks={prHint.checks} forge={prHint.forge} url={prHint.url} />
        </>
      ) : null}
      {agents.length > 0 ? (
        <>
          <div className="h-px bg-border" />
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

function preventFocusOpen(event: FocusEvent) {
  event.preventDefault();
}

/**
 * packages/app's WorkspaceHoverCard: the workspace's details beside its row on desktop, opening
 * at once and closing after a 100ms grace. Compact layouts have no hover, so no card.
 */
export function WorkspaceHoverCard({
  workspace,
  disabled = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  disabled?: boolean;
  children: ReactElement;
}) {
  const isCompact = useIsCompactFormFactor();
  const [open, setOpen] = useState(false);
  const handleOpenChange = useCallback((next: boolean) => setOpen(next && !disabled), [disabled]);
  const isOpen = useMemo(() => open && !disabled, [disabled, open]);
  if (isCompact) return children;
  return (
    <HoverCard open={isOpen} onOpenChange={handleOpenChange} openDelay={0} closeDelay={100}>
      {/* Hover only, as in packages/app: a row that keeps focus after a click must not hold the card open. */}
      <HoverCardTrigger asChild onFocus={preventFocusOpen}>
        {children}
      </HoverCardTrigger>
      {/* packages/app's card: 4px right of the row, top-aligned, kept 8px inside the window; a 1px
          borderAccent border, a 10px radius and its own 0 4px 8px black 20% shadow in every theme. */}
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className="w-[260px] rounded-[10px] border border-input p-0 pt-2 shadow-[0_4px_8px_rgba(0,0,0,0.2)] ring-0"
        data-testid="workspace-hover-card"
      >
        <HoverCardBody workspace={workspace} />
      </HoverCardContent>
    </HoverCard>
  );
}
