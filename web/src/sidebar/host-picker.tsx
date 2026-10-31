import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHostRuntimeSnapshot, useHosts, type ActiveConnection } from "@/runtime/host-runtime";
import { HostStatusDot } from "~/components/host-status-dot";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

function formatActiveConnection(connection: ActiveConnection): string {
  if (connection.type === "directSocket" || connection.type === "directPipe") return "Local";
  return connection.endpoint.replace(/:(?:443|80)$/, "");
}

function HostOption({
  serverId,
  label,
  onOpenSettings,
}: {
  serverId: string;
  label: string;
  onOpenSettings: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const openSettings = useCallback(() => onOpenSettings(serverId), [onOpenSettings, serverId]);
  const handleSettingsClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onOpenSettings(serverId);
    },
    [onOpenSettings, serverId],
  );
  return (
    <CommandItem
      value={`${label} ${serverId}`}
      onSelect={openSettings}
      data-testid={`sidebar-host-row-${serverId}`}
      className="group/host"
    >
      <HostStatusDot serverId={serverId} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {activeConnection ? (
          <span className="truncate text-xs text-muted-foreground">
            {formatActiveConnection(activeConnection)}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        aria-label={t("sidebar.host.openSettings", { defaultValue: `Open ${label} settings` })}
        onClick={handleSettingsClick}
        className="flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-data-[selected=true]/host:opacity-100 hover:text-foreground"
      >
        <Settings className="size-3.5" />
      </button>
    </CommandItem>
  );
}

/** The sidebar's host list (packages/app's HostPicker as the sidebar configures it): open a host's settings, or add one. */
export function SidebarHostPicker({
  children,
  onAddHost,
  onOpenHostSettings,
}: {
  children: ReactNode;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const [open, setOpen] = useState(false);
  const addHost = useCallback(() => {
    setOpen(false);
    onAddHost();
  }, [onAddHost]);
  const openHostSettings = useCallback(
    (serverId: string) => {
      setOpen(false);
      onOpenHostSettings(serverId);
    },
    [onOpenHostSettings],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t("sidebar.host.searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>
              {t("sidebar.host.noResults", { defaultValue: "No hosts found." })}
            </CommandEmpty>
            <CommandGroup>
              {hosts.map((host) => (
                <HostOption
                  key={host.serverId}
                  serverId={host.serverId}
                  label={host.label?.trim() || host.serverId}
                  onOpenSettings={openHostSettings}
                />
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem onSelect={addHost} data-testid="sidebar-host-add">
                <Plus />
                {t("sidebar.host.addHost", { defaultValue: "Add host" })}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
