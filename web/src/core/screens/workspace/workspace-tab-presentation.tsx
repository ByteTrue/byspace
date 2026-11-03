// Port of archive/expo-app:packages/app/src/screens/workspace/workspace-tab-presentation.tsx: the same
// presentation resolver; the icon and option row are DOM.
import { useMemo, type ComponentType, type ReactElement, type ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { StatusRing } from "@/components/status-ring";
import { usePanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { getPanelRegistration, type PanelIconProps } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { cn } from "cn";
import { Item } from "~/components/ui/item";

export interface WorkspaceTabPresentation {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  subtitle: string;
  tooltip: string;
  modified: boolean;
  titleState: "ready" | "loading";
  icon: ComponentType<PanelIconProps>;
  statusBucket: SidebarStateBucket | null;
}

interface WorkspaceTabPresentationResolverProps {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  children: (presentation: WorkspaceTabPresentation) => ReactNode;
}

export function WorkspaceTabPresentationResolver({
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverProps): ReactElement {
  ensurePanelsRegistered();
  const registration = getPanelRegistration(tab.kind);
  invariant(registration, `No panel registration for kind: ${tab.kind}`);
  return (
    <WorkspaceTabPresentationResolverInner
      key={`${tab.key}:${tab.kind}`}
      registration={registration}
      tab={tab}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {children}
    </WorkspaceTabPresentationResolverInner>
  );
}

function WorkspaceTabPresentationResolverInner({
  registration,
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverProps & {
  registration: NonNullable<ReturnType<typeof getPanelRegistration>>;
}): ReactElement {
  const descriptor = registration.useDescriptor(tab.target as never, {
    serverId,
    workspaceId,
    tabId: tab.tabId,
  });
  const attributes = usePanelInstanceAttributes({ serverId, workspaceId, tabId: tab.tabId });
  const presentation = useMemo(
    () => ({
      key: tab.key,
      kind: tab.kind,
      label: descriptor.label,
      subtitle: descriptor.subtitle,
      tooltip: descriptor.tooltip,
      modified: attributes.modified,
      titleState: descriptor.titleState,
      icon: descriptor.icon,
      statusBucket: descriptor.statusBucket,
    }),
    [
      descriptor.icon,
      descriptor.label,
      descriptor.tooltip,
      descriptor.statusBucket,
      descriptor.subtitle,
      descriptor.titleState,
      tab.key,
      tab.kind,
      attributes.modified,
    ],
  );
  return <>{children(presentation)}</>;
}

const STATUS_DOT_CLASS: Partial<Record<SidebarStateBucket, string>> = {
  failed: "bg-status-dot-danger",
  attention: "bg-status-dot-success",
};

const BACKDROP_BORDER: Record<string, string> = {
  surface0: "border-background",
  surface1: "border-card",
};

/**
 * The tab's panel icon with its agent status on the bottom-right corner: the running ring, a
 * failed or attention dot, or the needs-input alert. Same offsets as the Expo app.
 */
export function WorkspaceTabIcon({
  presentation,
  active = false,
  size = 14,
  strokeWidth,
  backdrop,
}: {
  presentation: WorkspaceTabPresentation;
  active?: boolean;
  size?: number;
  strokeWidth?: number;
  statusDotBorderColor?: string;
  backdrop: SurfaceBackdrop;
}): ReactElement {
  const bucket = presentation.statusBucket;
  const dotClass = bucket ? STATUS_DOT_CLASS[bucket] : undefined;
  const Icon = presentation.icon;
  const frameStyle = useMemo(() => ({ width: size, height: size }), [size]);
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center",
        active ? "text-foreground" : "text-muted-foreground",
      )}
      style={frameStyle}
    >
      <Icon size={size} color="currentColor" strokeWidth={strokeWidth} />
      {bucket === "running" ? (
        <span
          className="absolute -right-1 -bottom-1 flex"
          role="progressbar"
          aria-label="Agent running"
        >
          <StatusRing backdrop={backdrop} />
        </span>
      ) : null}
      {dotClass ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2 rounded-full border",
            dotClass,
            BACKDROP_BORDER[backdrop] ?? "border-background",
          )}
        />
      ) : null}
      {bucket === "needs_input" ? (
        <span className="absolute -right-[3px] -bottom-[3px] flex">
          <CircleAlert
            size={12}
            className="fill-status-dot-warning text-background"
            aria-hidden="true"
          />
        </span>
      ) : null}
    </span>
  );
}

/** A row in the phone tab switcher. */
export function WorkspaceTabOptionRow({
  presentation,
  selected,
  active,
  onPress,
  trailingAccessory,
}: {
  presentation: WorkspaceTabPresentation;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  trailingAccessory?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  return (
    // The Expo app highlights the row, and the hovered/pressed press area, with surface1 (card):
    // the same white as the sheet in light, a step lighter in dark.
    <div className={cn("mx-1 mb-1 flex min-h-9 items-center gap-2 px-1 py-1", active && "bg-card")}>
      <Item asChild size="xs" className="text-left">
        <button
          type="button"
          onClick={onPress}
          className={cn("group/option min-w-0 flex-1 hover:bg-muted", active && "bg-muted")}
        >
          <span className="flex w-4 items-center justify-center">
            <WorkspaceTabIcon
              presentation={presentation}
              active={selected || active}
              backdrop="surface0"
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm leading-[normal] text-foreground">
            {presentation.titleState === "loading"
              ? t("workspace.tabs.loading")
              : presentation.label}
          </span>
        </button>
      </Item>
      {presentation.modified ? (
        <span
          className="size-2 shrink-0 rounded-full bg-muted-foreground"
          aria-label={t("workspace.tabs.modified")}
        />
      ) : null}
      {selected ? (
        <span className="flex w-4 items-center justify-center text-muted-foreground">
          <Check size={16} />
        </span>
      ) : null}
      {trailingAccessory ? (
        <span className="flex items-center justify-center">{trailingAccessory}</span>
      ) : null}
    </div>
  );
}
