import { useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { cn } from "cn";

/** The Expo app's HostStatusDot: green online, amber connecting, red otherwise. */
export function HostStatusDot({ serverId, className }: { serverId: string; className?: string }) {
  const status = useHostRuntimeConnectionStatus(serverId);
  let color = "bg-status-danger";
  if (status === "online") color = "bg-status-success";
  else if (status === "connecting") color = "bg-status-warning";
  return <span className={cn("size-2 shrink-0 rounded-full", color, className)} />;
}
