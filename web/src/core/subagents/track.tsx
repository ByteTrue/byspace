// Port of archive/expo-app:packages/app/src/subagents/track.tsx: the subagents pill above the composer and its
// panel — one row per subagent (open it; archive or detach a BySpace one on hover, always on a
// phone) and "archive finished" above the rows.
import { useCallback, useMemo, type MouseEvent, type ReactElement } from "react";
import { Archive, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getProviderIcon } from "@/components/provider-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { ComposerTrackActions, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { SubagentRow } from "@/subagents/select";
import {
  buildSubagentPillPresentation,
  buildSubagentRowPresentationData,
  countFinishedSubagents,
} from "@/subagents/track-presentation";
import type { ArchiveFinishedStatus } from "@/subagents/use-archive-finished";
import { cn } from "cn";
import { Button } from "~/components/ui/button";

export interface SubagentsTrackProps {
  serverId: string;
  rows: SubagentRow[];
  onOpenSubagent: (id: string) => void;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
  onArchiveSubagent: (id: string) => void;
  onArchiveFinished?: () => void;
  archiveFinishedStatus?: ArchiveFinishedStatus;
  onDetachSubagent?: (id: string) => void;
}

const IDLE_ARCHIVE_FINISHED_STATUS: ArchiveFinishedStatus = { kind: "idle" };
const ROW_ICON_SIZE = 14;

function buildRowPresentation(row: SubagentRow, serverId: string): WorkspaceTabPresentation {
  const data = buildSubagentRowPresentationData(row);
  return {
    ...data,
    tooltip: data.label,
    modified: false,
    icon: getProviderIcon(row.provider, serverId),
  };
}

export function SubagentsTrack({
  serverId,
  rows,
  onOpenSubagent,
  onOpenProviderSubagent,
  onArchiveSubagent,
  onArchiveFinished,
  archiveFinishedStatus = IDLE_ARCHIVE_FINISHED_STATUS,
  onDetachSubagent,
}: SubagentsTrackProps): ReactElement | null {
  const { t } = useTranslation();
  const isArchivingFinished = archiveFinishedStatus.kind === "archiving";
  const isArchiveFinishedFailed = archiveFinishedStatus.kind === "failed";
  if (rows.length === 0 && !isArchivingFinished && !isArchiveFinishedFailed) return null;
  const pill = buildSubagentPillPresentation(t, rows);
  const finishedCount = countFinishedSubagents(rows);
  const showArchiveFinished = finishedCount > 0 || isArchivingFinished || isArchiveFinishedFailed;
  return (
    <ComposerTrackPill
      testID="subagents-track-header"
      segments={pill.segments}
      accessibilityLabel={pill.accessibilityLabel}
      panelTitle={t("subagents.title")}
    >
      {showArchiveFinished && onArchiveFinished ? (
        <ComposerTrackActions divided={rows.length > 0}>
          <ArchiveFinishedRow
            status={archiveFinishedStatus}
            disabled={isArchivingFinished}
            onPress={onArchiveFinished}
          />
        </ComposerTrackActions>
      ) : null}
      {rows.map((row) => (
        <SubagentsTrackRow
          key={row.id}
          row={row}
          serverId={serverId}
          onOpenSubagent={onOpenSubagent}
          onOpenProviderSubagent={onOpenProviderSubagent}
          onArchiveSubagent={onArchiveSubagent}
          onDetachSubagent={onDetachSubagent}
        />
      ))}
    </ComposerTrackPill>
  );
}

const ROW_LABEL = "min-w-0 shrink grow basis-auto truncate text-sm text-foreground";
const ROW_TRAILING = "min-w-0 shrink-[2] truncate text-xs text-muted-foreground";

function ArchiveFinishedRow({
  status,
  disabled,
  onPress,
}: {
  status: ArchiveFinishedStatus;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <Archive
          size={ROW_ICON_SIZE}
          className={active ? "text-foreground" : "text-muted-foreground"}
        />
        <span className={ROW_LABEL}>{t("subagents.archiveFinishedAction")}</span>
        {status.kind === "archiving" ? (
          <span className={ROW_TRAILING} data-testid="subagents-track-archive-progress">
            {status.completedCount}/{status.totalCount}
          </span>
        ) : null}
        {status.kind === "failed" ? (
          <span className={ROW_TRAILING} data-testid="subagents-track-archive-failed">
            {t("subagents.archiveFinishedRetry", {
              failed: status.failedCount,
              total: status.totalCount,
            })}
          </span>
        ) : null}
      </>
    ),
    [status, t],
  );
  return (
    <ComposerTrackRow
      accessibilityLabel={t("subagents.archiveFinishedAction")}
      testID="subagents-track-archive-finished"
      disabled={disabled}
      closeOnSelect={false}
      onPress={onPress}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

function SubagentsTrackRow({
  serverId,
  row,
  onOpenSubagent,
  onOpenProviderSubagent,
  onArchiveSubagent,
  onDetachSubagent,
}: {
  serverId: string;
  row: SubagentRow;
  onOpenSubagent: (id: string) => void;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
  onArchiveSubagent: (id: string) => void;
  onDetachSubagent?: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const presentation = useMemo(() => buildRowPresentation(row, serverId), [row, serverId]);
  const displayLabel =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;
  const handlePress = useCallback(() => {
    if (row.kind === "provider") onOpenProviderSubagent(row.parentAgentId, row.id);
    else onOpenSubagent(row.id);
  }, [onOpenProviderSubagent, onOpenSubagent, row]);
  const handleArchivePress = useCallback(
    () => onArchiveSubagent(row.id),
    [onArchiveSubagent, row.id],
  );
  const handleDetachPress = useCallback(
    () => onDetachSubagent?.(row.id),
    [onDetachSubagent, row.id],
  );
  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <WorkspaceTabIcon presentation={presentation} backdrop={active ? "surface2" : "surface1"} />
        <span className={ROW_LABEL}>{displayLabel}</span>
        {presentation.subtitle ? (
          <span className={ROW_TRAILING}>{presentation.subtitle}</span>
        ) : null}
        {row.kind === "byspace" ? (
          <SubagentRowActions
            rowId={row.id}
            displayLabel={displayLabel}
            visible={isCompact || active}
            onDetachPress={onDetachSubagent ? handleDetachPress : undefined}
            onArchivePress={handleArchivePress}
          />
        ) : null}
      </>
    ),
    [
      displayLabel,
      handleArchivePress,
      handleDetachPress,
      isCompact,
      onDetachSubagent,
      presentation,
      row.id,
      row.kind,
    ],
  );
  return (
    <ComposerTrackRow
      accessibilityLabel={displayLabel}
      testID={`subagents-track-row-${row.id}`}
      onPress={handlePress}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

function SubagentRowActions({
  rowId,
  displayLabel,
  visible,
  onDetachPress,
  onArchivePress,
}: {
  rowId: string;
  displayLabel: string;
  visible: boolean;
  onDetachPress?: () => void;
  onArchivePress: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex items-center gap-1",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {onDetachPress ? (
        <SubagentActionButton
          accessibilityLabel={t("subagents.detachAction", { label: displayLabel })}
          testID={`subagents-track-detach-${rowId}`}
          tooltipLabel={t("subagents.detachTooltip")}
          icon="detach"
          visible={visible}
          onPress={onDetachPress}
        />
      ) : null}
      <SubagentActionButton
        accessibilityLabel={t("subagents.archiveAction", { label: displayLabel })}
        testID={`subagents-track-archive-${rowId}`}
        tooltipLabel={t("subagents.archiveTooltip")}
        icon="archive"
        visible={visible}
        onPress={onArchivePress}
      />
    </div>
  );
}

function SubagentActionButton({
  accessibilityLabel,
  testID,
  tooltipLabel,
  icon,
  visible,
  onPress,
}: {
  accessibilityLabel: string;
  testID: string;
  tooltipLabel: string;
  icon: "archive" | "detach";
  visible: boolean;
  onPress: () => void;
}): ReactElement {
  const Icon = icon === "detach" ? Unlink : Archive;
  // The row is pressable too; the action must not open the subagent.
  const handleClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild disabled={!visible}>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={accessibilityLabel}
          data-testid={testID}
          onClick={handleClick}
          tabIndex={visible ? 0 : -1}
        >
          <Icon size={ROW_ICON_SIZE} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}
