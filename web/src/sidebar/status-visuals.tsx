import { useLayoutEffect, useMemo, useRef } from "react";
import { CircleAlert, Folder, FolderGit2, Monitor } from "lucide-react";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import { getProjectStatusBadgeContent } from "@/utils/project-status-badge-content";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";

// Geometry from packages/app/src/components/status-ring/geometry.ts: a 6px dot inside a 1.5px
// ring with a 1.5px gap, turning once every 900ms.
const RING_PERIOD_MS = 900;

/** The running indicator: a faint track with a turning arc around a dot, all rings in step. */
export function StatusRing({ className }: { className?: string }) {
  const arcRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const arc = arcRef.current;
    if (!arc) return;
    const animation = arc.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      {
        duration: RING_PERIOD_MS,
        easing: "linear",
        iterations: Number.POSITIVE_INFINITY,
      },
    );
    // One shared timeline origin keeps every ring on the page at the same angle.
    animation.startTime = 0;
    return () => animation.cancel();
  }, []);
  return (
    <span
      className={cn("relative inline-flex size-3 shrink-0 items-center justify-center", className)}
      data-testid="status-ring"
    >
      <span className="absolute inset-0 rounded-full border-[1.5px] border-status-dot-running opacity-30" />
      <span
        ref={arcRef}
        className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-status-dot-running opacity-90"
      />
      <span className="size-1.5 rounded-full bg-status-dot-running" />
    </span>
  );
}

const DOT_CLASS: Record<SidebarStateBucket, string | null> = {
  needs_input: "bg-status-dot-warning",
  failed: "bg-status-dot-danger",
  running: "bg-status-dot-running",
  attention: "bg-status-dot-success",
  done: null,
};

/** packages/app's WorkspaceStatusIndicator: what a workspace row shows in its leading slot. */
export function WorkspaceStatusIndicator({
  bucket,
  workspaceKind,
  loading = false,
  reserveIdleSpace = true,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"];
  loading?: boolean;
  reserveIdleSpace?: boolean;
}) {
  const slot = "flex size-4 shrink-0 items-center justify-center";
  if (loading) {
    return (
      <span className={slot} data-testid="workspace-status-indicator-loading">
        <StatusRing />
      </span>
    );
  }
  if (shouldRenderSyncedStatusLoader({ bucket })) {
    return (
      <span className={slot} data-testid="workspace-status-indicator-running">
        <StatusRing />
      </span>
    );
  }
  if (bucket === "needs_input") {
    return (
      <span className={slot} data-testid="workspace-status-indicator-needs_input">
        <CircleAlert className="size-3 fill-status-dot-warning text-sidebar" />
      </span>
    );
  }
  if (bucket === "attention") {
    return (
      <span className={slot} data-testid="workspace-status-indicator-attention">
        <span className="size-1.5 rounded-full bg-status-dot-success" />
      </span>
    );
  }
  if (bucket === "done") {
    return reserveIdleSpace ? (
      <span className={slot} data-testid="workspace-status-indicator-done">
        <span className="size-1.5 rounded-full bg-sidebar-border" />
      </span>
    ) : null;
  }
  let KindIcon = Folder;
  if (workspaceKind === "local_checkout") KindIcon = Monitor;
  else if (workspaceKind === "worktree") KindIcon = FolderGit2;
  const dot = DOT_CLASS[bucket];
  return (
    <span className={cn(slot, "relative")} data-testid={`workspace-status-indicator-${bucket}`}>
      <KindIcon className="size-3.5 text-muted-foreground" />
      {dot ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-sidebar",
            dot,
          )}
        />
      ) : null}
    </span>
  );
}

/** A project's icon, or its initial on the project's identity colour. */
export function ProjectIcon({
  iconDataUri,
  displayName,
  projectViewKey,
  size = 16,
}: {
  iconDataUri: string | null;
  displayName: string;
  projectViewKey: string;
  size?: number;
}) {
  const box = useMemo(
    () => ({ width: size, height: size, borderRadius: Math.round(size * 0.25) }),
    [size],
  );
  const placeholderStyle = useMemo(
    () => ({
      ...box,
      backgroundColor: identityColor(deriveIdentityColorName(projectViewKey)),
      fontSize: Math.round(size * 0.62),
    }),
    [box, projectViewKey, size],
  );
  if (iconDataUri) {
    return <img src={iconDataUri} alt="" className="shrink-0 object-cover" style={box} />;
  }
  const initial = projectIconPlaceholderLabelFromDisplayName(displayName).charAt(0).toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={placeholderStyle}
    >
      {initial}
    </span>
  );
}

function ProjectStatusBadgeGlyph({
  badge,
}: {
  badge: NonNullable<ReturnType<typeof getProjectStatusBadgeContent>>;
}) {
  if (badge.kind === "alert")
    return <CircleAlert className="size-3 fill-status-dot-warning text-sidebar" />;
  if (badge.bucket === "running") return <StatusRing className="size-2.5" />;
  return (
    <span
      data-testid="project-status-dot"
      className={cn("size-1.5 rounded-full", DOT_CLASS[badge.bucket])}
    />
  );
}

/** The project icon with the workspace's status as a badge on its corner. */
export function ProjectStatusIndicator({
  iconDataUri,
  displayName,
  projectViewKey,
  statusBucket,
  loading = false,
  testId,
}: {
  iconDataUri: string | null;
  displayName: string;
  projectViewKey: string;
  statusBucket: SidebarStateBucket | null;
  loading?: boolean;
  testId?: string;
}) {
  const badgeBucket = loading ? "running" : statusBucket;
  const badge = getProjectStatusBadgeContent(badgeBucket);
  return (
    <span
      className="relative flex size-4 shrink-0 items-center justify-center"
      data-testid={
        testId ??
        (statusBucket && statusBucket !== "done"
          ? `project-status-indicator-${statusBucket}`
          : "project-icon-only")
      }
    >
      <ProjectIcon
        iconDataUri={iconDataUri}
        displayName={displayName}
        projectViewKey={projectViewKey}
      />
      {badge && badgeBucket ? (
        <span
          role="status"
          aria-label={STATUS_BUCKET_LABELS[badgeBucket]}
          data-testid="project-status-badge"
          className="absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full bg-sidebar"
        >
          <ProjectStatusBadgeGlyph badge={badge} />
        </span>
      ) : null}
    </span>
  );
}

/** The project row's leading slot: the icon, or a spinner while the project is being removed. */
export function ProjectLeadingVisual({
  displayName,
  iconDataUri,
  projectViewKey,
  isArchiving = false,
}: {
  displayName: string;
  iconDataUri: string | null;
  projectViewKey: string;
  isArchiving?: boolean;
}) {
  if (isArchiving) {
    return (
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        data-testid="project-status-indicator-archiving"
      >
        <Spinner className="size-3 text-muted-foreground" />
      </span>
    );
  }
  return (
    <ProjectStatusIndicator
      iconDataUri={iconDataUri}
      displayName={displayName}
      projectViewKey={projectViewKey}
      statusBucket={null}
    />
  );
}
