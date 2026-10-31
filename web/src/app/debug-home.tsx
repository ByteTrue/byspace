import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { useHostRuntimeConnectionStatus, useHosts } from "@/runtime/host-runtime";

function HostRow({ serverId, label }: { serverId: string; label: string }) {
  const status = useHostRuntimeConnectionStatus(serverId);
  return (
    <li>
      {label} — {status}
    </li>
  );
}

export function DebugHome() {
  const hosts = useHosts();
  const { projects } = useSidebarWorkspacesList();
  return (
    <div className="p-6 text-sm">
      <h1 className="mb-2 font-medium">Hosts</h1>
      <ul className="mb-6">
        {hosts.map((host) => (
          <HostRow key={host.serverId} serverId={host.serverId} label={host.label} />
        ))}
      </ul>
      <h1 className="mb-2 font-medium">Projects</h1>
      <ul>
        {projects.map((project) => (
          <li key={project.viewKey}>
            {project.projectName} ({project.workspaces.length})
          </li>
        ))}
      </ul>
    </div>
  );
}
