// Port of archive/expo-app:packages/app/src/components/schedules/schedule-row.tsx: one schedule in the Schedules list; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/schedules.py; edit it directly.
import { MoreVertical, Pause, Pencil, Play, RotateCw, Trash2 } from "lucide-react";
import {
  useCallback,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ComponentProps,
} from "react";
import { cn } from "cn";
import { Badge } from "~/components/ui/badge";
import { getProviderIcon } from "@/components/provider-icons";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { ScheduleDerivedState } from "@/schedules/schedule-derivation";
import {
  formatCadence,
  formatNextRun,
  resolveScheduleTitle,
  scheduleProductName,
} from "@/utils/schedule-format";
import { formatTimeAgo } from "@/utils/time";
import type { ScheduleSummary } from "@bytetrue/protocol/schedule/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";
import { Spinner } from "~/components/ui/spinner";
import { Item, ItemDescription, ItemTitle } from "~/components/ui/item";

const MENU_ICON_SIZE = 14;
const PROVIDER_ICON_SIZE = 16;

// Pending flags for each action so the parent table can wire a mutation hook
// and the row reflects in-flight state without owning the mutation itself.
export interface ScheduleRowPending {
  pause?: boolean;
  resume?: boolean;
  runNow?: boolean;
  delete?: boolean;
}

export interface ScheduleRowActions {
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}

interface ScheduleRowProps extends ScheduleRowActions {
  serverId: string;
  schedule: ScheduleSummary;
  /** Client-derived target line (agent title / project / shortened path). */
  targetLabel: string;
  /** Provider glyph, resolved from the schedule config or the target agent. */
  provider: string | null;
  /** Client-derived state — the single source for the badge and next-run copy. */
  state: ScheduleDerivedState;
  /** Host name, rendered when the list spans more than one host. */
  serverName?: string;
  /** True when only one host exists and the host name would be redundant. */
  singleHost?: boolean;
  pending?: ScheduleRowPending;
}

function stateBadge(state: ScheduleDerivedState): { label: string; className?: string } {
  switch (state) {
    case "active":
      return { label: "Active", className: "text-status-success" };
    case "paused":
      return { label: "Paused" };
    case "expired":
      return { label: "Expired" };
    case "finished":
      return { label: "Finished" };
    case "targetGone":
      return { label: "Target gone", className: "text-status-danger" };
  }
}

// Meta reads left-to-right as identity → history → future: how often, when it
// was created, when it last ran, and (only while it can still run) when it runs
// next. Status lives on the badge, never repeated here.
function buildMeta(
  schedule: ScheduleSummary,
  state: ScheduleDerivedState,
  serverName: string | undefined,
  singleHost: boolean,
): string {
  const parts = [
    formatCadence(schedule.cadence),
    `Created ${formatTimeAgo(new Date(schedule.createdAt))}`,
    schedule.lastRunAt ? `Last run ${formatTimeAgo(new Date(schedule.lastRunAt))}` : "Never run",
  ];
  if (state === "active") {
    const next = formatNextRun(schedule.nextRunAt);
    if (next) {
      parts.push(`Next run ${next}`);
    }
  }
  if (serverName && !singleHost) {
    parts.unshift(serverName);
  }
  return parts.join(" · ");
}

/** Small provider glyph in the muted colour. */
function ProviderGlyph({
  provider,
  serverId,
}: {
  provider: string | null;
  serverId: string;
}): ReactElement | null {
  if (!provider) {
    return null;
  }
  const Icon = getProviderIcon(provider, serverId);
  return (
    <span className="flex text-muted-foreground">
      <Icon size={PROVIDER_ICON_SIZE} color="currentColor" />
    </span>
  );
}

// The row opens the editor; its menu must not.
function stopClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

/**
 * One schedule, rendered as a settings-style card row: provider glyph + title,
 * a muted secondary line (model · cadence · next run), a StatusBadge, and the
 * kebab menu that owns every row action. Tapping the row opens the editor.
 *
 * The row is a focusable div rather than a button, because it holds the kebab
 * button; it presses on click, Enter and Space. Hovering highlights it on desktop.
 */
export function ScheduleRow({
  serverId,
  schedule,
  targetLabel,
  provider,
  state,
  serverName,
  singleHost,
  pending,
  onEdit,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: ScheduleRowProps): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }
      event.preventDefault();
      onEdit();
    },
    [onEdit],
  );

  const title = resolveScheduleTitle(schedule);
  const productName = scheduleProductName(schedule);
  const badge = stateBadge(state);
  const meta = buildMeta(schedule, state, serverName, singleHost ?? false);
  const canRun = schedule.target.type === "new-agent" && (state === "active" || state === "paused");

  return (
    <Item
      variant="outline"
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={handleKeyDown}
      aria-label={`Edit ${productName.toLowerCase()} ${title}`}
      data-testid={`schedule-row-${schedule.id}`}
      className={cn(
        "relative cursor-pointer gap-3 active:bg-accent",
        !isCompact && "hover:bg-muted",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-row items-start gap-3">
        <div className="flex h-5 w-4 shrink-0 items-center justify-center">
          <ProviderGlyph provider={provider} serverId={serverId} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <ItemTitle className="truncate">{title}</ItemTitle>
          <span className="mt-1 truncate text-sm leading-[normal] text-muted-foreground">
            {targetLabel}
          </span>
          <ItemDescription className="truncate">{meta}</ItemDescription>
        </div>
      </div>

      <div className="flex flex-row items-center gap-2" onClick={stopClickPropagation}>
        <Badge variant="secondary" className={badge.className}>
          {badge.label}
        </Badge>
        <ScheduleKebabMenu
          schedule={schedule}
          canRun={canRun}
          pending={pending}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
          onRunNow={onRunNow}
          onDelete={onDelete}
        />
      </div>
    </Item>
  );
}

const editLeading = <Pencil size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const pauseLeading = <Pause size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const resumeLeading = <Play size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const runLeading = <RotateCw size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const deleteLeading = <Trash2 size={MENU_ICON_SIZE} className="text-destructive" />;

/** A menu row that shows a spinner and its pending label while its request runs. */
function PendingMenuItem({
  pending,
  pendingLabel,
  icon,
  label,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & {
  pending: boolean | undefined;
  pendingLabel: string;
  icon: ReactElement;
  label: string;
}): ReactElement {
  return (
    <DropdownMenuItem {...props} disabled={props.disabled || pending}>
      {pending ? <Spinner /> : icon}
      {pending ? pendingLabel : label}
    </DropdownMenuItem>
  );
}

function ScheduleExecutionMenuItems({
  schedule,
  canRun,
  pending,
  onPause,
  onResume,
  onRunNow,
}: Pick<ScheduleRowProps, "schedule" | "pending" | "onPause" | "onResume" | "onRunNow"> & {
  canRun: boolean;
}): ReactElement | null {
  if (schedule.target.type === "agent") {
    return null;
  }

  let cadenceAction: ReactElement;
  if (schedule.status === "paused") {
    cadenceAction = (
      <PendingMenuItem
        disabled={!canRun}
        pending={pending?.resume}
        pendingLabel="Resuming..."
        icon={resumeLeading}
        label="Resume schedule"
        onSelect={onResume}
        data-testid={`schedule-menu-resume-${schedule.id}`}
      />
    );
  } else {
    cadenceAction = (
      <PendingMenuItem
        disabled={schedule.status === "completed" || !canRun}
        pending={pending?.pause}
        pendingLabel="Pausing..."
        icon={pauseLeading}
        label="Pause schedule"
        onSelect={onPause}
        data-testid={`schedule-menu-pause-${schedule.id}`}
      />
    );
  }

  return (
    <>
      {cadenceAction}
      <PendingMenuItem
        disabled={!canRun}
        pending={pending?.runNow}
        pendingLabel="Starting..."
        icon={runLeading}
        label="Run now"
        onSelect={onRunNow}
        data-testid={`schedule-menu-run-${schedule.id}`}
      />
    </>
  );
}

function ScheduleKebabMenu({
  schedule,
  canRun,
  pending,
  onEdit,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: Pick<
  ScheduleRowProps,
  "schedule" | "pending" | "onEdit" | "onPause" | "onResume" | "onRunNow" | "onDelete"
> & {
  canRun: boolean;
}): ReactElement {
  const productName = scheduleProductName(schedule);
  const productNameLower = productName.toLowerCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${productName} actions`}
        data-testid={`schedule-kebab-${schedule.id}`}
        className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MoreVertical size={MENU_ICON_SIZE} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]" onCloseAutoFocus={keepFocusElsewhere}>
        <DropdownMenuItem onSelect={onEdit} data-testid={`schedule-menu-edit-${schedule.id}`}>
          {editLeading}
          Edit {productNameLower}
        </DropdownMenuItem>
        <ScheduleExecutionMenuItems
          schedule={schedule}
          canRun={canRun}
          pending={pending}
          onPause={onPause}
          onResume={onResume}
          onRunNow={onRunNow}
        />
        <DropdownMenuSeparator />
        <PendingMenuItem
          variant="destructive"
          pending={pending?.delete}
          pendingLabel="Deleting..."
          icon={deleteLeading}
          label={`Delete ${productNameLower}`}
          onSelect={onDelete}
          data-testid={`schedule-menu-delete-${schedule.id}`}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
