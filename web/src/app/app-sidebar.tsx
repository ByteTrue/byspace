import { NavLink, useParams } from "react-router";
import type {
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { useAppSettings } from "@/hooks/use-settings";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarStateBucket } from "@/hooks/sidebar-workspaces-view-model";
import { useHostRuntimeConnectionStatus, useHosts } from "@/runtime/host-runtime";
import { buildHostWorkspaceRoute, decodeWorkspaceIdFromPathSegment } from "@/utils/host-routes";
import { cn } from "cn";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";

const STATUS_DOT: Record<SidebarStateBucket, string> = {
  needs_input: "bg-amber-500",
  failed: "bg-destructive",
  running: "",
  attention: "bg-sky-500",
  done: "",
};

function WorkspaceStatus({ bucket }: { bucket: SidebarStateBucket | undefined }) {
  if (bucket === "running") return <Spinner className="size-3 text-muted-foreground" />;
  const dot = bucket ? STATUS_DOT[bucket] : "";
  if (!dot) return null;
  return <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />;
}

function HostStatus() {
  const hosts = useHosts();
  const first = hosts[0];
  const status = useHostRuntimeConnectionStatus(first?.serverId ?? "");
  if (!first) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "online" ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
      <span className="truncate">{first.label}</span>
    </span>
  );
}

function WorkspaceRow({
  workspace,
  entry,
  isActive,
}: {
  workspace: SidebarWorkspacePlacement;
  entry: SidebarWorkspaceEntry | undefined;
  isActive: boolean;
}) {
  const { settings } = useAppSettings();
  const label = entry
    ? resolveSidebarWorkspacePrimaryLabel({
        workspace: entry,
        workspaceTitleSource: settings.workspaceTitleSource,
      })
    : workspace.name;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        // BySpace: the selected row also carries a 2px bar on its left edge.
        className="relative before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-foreground before:opacity-0 data-[active=true]:before:opacity-100"
      >
        <NavLink to={buildHostWorkspaceRoute(workspace.serverId, workspace.workspaceId)}>
          <span className="flex-1 truncate">{label}</span>
          <WorkspaceStatus bucket={entry?.statusBucket} />
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { projects, workspacePlacements } = useSidebarWorkspacesList();
  const entries = useSidebarWorkspaceEntries(workspacePlacements);
  const params = useParams();
  const activeWorkspaceId = params.workspaceId
    ? decodeWorkspaceIdFromPathSegment(params.workspaceId)
    : null;

  return (
    <Sidebar variant="inset">
      <SidebarHeader className="gap-1 px-4 pt-3">
        <span className="text-sm font-semibold">BySpace</span>
        <HostStatus />
      </SidebarHeader>
      <SidebarContent>
        {projects.map((project) => (
          <SidebarGroup key={project.viewKey}>
            <SidebarGroupLabel>{project.projectName}</SidebarGroupLabel>
            <SidebarMenu>
              {project.workspaces.map((workspace) => (
                <WorkspaceRow
                  key={workspace.workspaceKey}
                  workspace={workspace}
                  isActive={
                    workspace.serverId === params.serverId &&
                    workspace.workspaceId === activeWorkspaceId
                  }
                  entry={entries.get(workspace.workspaceKey)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
