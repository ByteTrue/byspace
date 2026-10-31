import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { AppState } from "react-native";
import { SessionProvider } from "@/contexts/session-context";
import { ToastProvider } from "@/contexts/toast-context";
import { queryClient } from "@/data/query-client";
import { I18nProvider } from "@/i18n/provider";
import {
  bindHostRuntimeAppState,
  startHostRuntimeBootstrap,
} from "@/navigation/host-runtime-bootstrap";
import { getHostRuntimeStore, useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";

function HostRuntimeBootstrap() {
  useEffect(() => bindHostRuntimeAppState(getHostRuntimeStore(), AppState), []);
  useEffect(() => {
    startHostRuntimeBootstrap({ store: getHostRuntimeStore() });
  }, []);
  return null;
}

/** One SessionProvider per registered host keeps that host's agents and workspaces in the session store. */
function HostSession({ host }: { host: HostProfile }) {
  const client = useHostRuntimeClient(host.serverId);
  if (!client) return null;
  return (
    <SessionProvider serverId={host.serverId} client={client}>
      {null}
    </SessionProvider>
  );
}

function HostSessions() {
  const hosts = useHosts();
  return hosts.map((host) => <HostSession key={host.serverId} host={host} />);
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <HostRuntimeBootstrap />
          <HostSessions />
          {children}
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
