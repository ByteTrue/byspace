// Override of packages/app/src/hosts/host-chooser.tsx: the same chooser store and hook (no hosts:
// go add one; one host: use it; several: ask), with the picker on shadcn's CommandDialog.
import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { Server } from "lucide-react";
import { create } from "zustand";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHosts } from "@/runtime/host-runtime";
import { orderHostsLocalFirst, type HostProfile } from "@/types/host-connection";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import { HostStatusDot } from "~/components/host-status-dot";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";

type HostFilter = (host: HostProfile) => boolean;
type HostChoiceHandler = (serverId: string) => void | Promise<void>;

export interface ChooseHostInput {
  title?: string;
  filter?: HostFilter;
  onChooseHost: HostChoiceHandler;
  onNoHosts?: () => void;
}

interface HostChoiceRequest {
  id: number;
  title: string;
  serverIds: string[];
  onChooseHost: HostChoiceHandler;
}

interface HostChooserState {
  request: HostChoiceRequest | null;
  open: (request: Omit<HostChoiceRequest, "id">) => void;
  close: () => void;
}

let nextRequestId = 1;

const useHostChooserStore = create<HostChooserState>((set) => ({
  request: null,
  open: (request) => {
    set({ request: { ...request, id: nextRequestId++ } });
  },
  close: () => set({ request: null }),
}));

export function useHostChooser() {
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const open = useHostChooserStore((state) => state.open);

  return useCallback(
    (input: ChooseHostInput) => {
      const availableHosts = orderHostsLocalFirst(hosts, localServerId).filter(
        input.filter ?? (() => true),
      );
      if (availableHosts.length === 0) {
        (input.onNoHosts ?? (() => router.push(buildSettingsAddHostRoute(Date.now()))))();
        return false;
      }
      if (availableHosts.length === 1) {
        void input.onChooseHost(availableHosts[0].serverId);
        return true;
      }
      open({
        title: input.title ?? "Choose host",
        serverIds: availableHosts.map((host) => host.serverId),
        onChooseHost: input.onChooseHost,
      });
      return true;
    },
    [hosts, localServerId, open],
  );
}

function HostChooserItem({
  host,
  onChoose,
}: {
  host: HostProfile;
  onChoose: (serverId: string) => void;
}) {
  const handleSelect = useCallback(() => onChoose(host.serverId), [host.serverId, onChoose]);
  return (
    <CommandItem
      value={`${host.label} ${host.serverId}`}
      onSelect={handleSelect}
      data-testid={`host-chooser-row-${host.serverId}`}
    >
      <HostStatusDot serverId={host.serverId} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{host.label}</span>
        <span className="truncate text-xs text-muted-foreground">{host.serverId}</span>
      </span>
      <Server className="text-muted-foreground" />
    </CommandItem>
  );
}

export function HostChooserModal() {
  const hosts = useHosts();
  const request = useHostChooserStore((state) => state.request);
  const close = useHostChooserStore((state) => state.close);
  const requestHosts = useMemo(() => {
    if (!request) return [];
    const hostByServerId = new Map(hosts.map((host) => [host.serverId, host] as const));
    return request.serverIds.flatMap((serverId) => {
      const host = hostByServerId.get(serverId);
      return host ? [host] : [];
    });
  }, [hosts, request]);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close],
  );
  const chooseHost = useCallback(
    (serverId: string) => {
      const currentRequest = request;
      close();
      if (currentRequest) void currentRequest.onChooseHost(serverId);
    },
    [close, request],
  );
  return (
    <CommandDialog
      key={request?.id}
      open={request !== null}
      onOpenChange={handleOpenChange}
      title={request?.title ?? "Choose host"}
      description={request?.title ?? "Choose host"}
    >
      <Command data-testid="host-chooser">
        <CommandInput placeholder="Search hosts..." data-testid="host-chooser-search" />
        <CommandList>
          <CommandEmpty>No matching hosts</CommandEmpty>
          <CommandGroup heading={request?.title}>
            {requestHosts.map((host) => (
              <HostChooserItem key={host.serverId} host={host} onChoose={chooseHost} />
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
