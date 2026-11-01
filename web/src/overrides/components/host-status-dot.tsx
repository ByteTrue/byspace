// Override of packages/app/src/components/host-status-dot.tsx: the host's connection as a dot.
import { useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { cn } from "cn";

export function HostStatusDot({ serverId }: { serverId: string }) {
  const status = useHostRuntimeConnectionStatus(serverId);
  let color = "bg-status-danger";
  if (status === "online") color = "bg-status-success";
  else if (status === "connecting") color = "bg-status-warning";
  return <span className={cn("block size-2 shrink-0 rounded-full", color)} />;
}
