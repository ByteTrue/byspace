import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RemoteWebService, RemoteWebServiceTarget } from "@bytetrue/byspace-protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function remoteWebServicesQueryKey(serverId: string) {
  return ["remoteWebServices", serverId] as const;
}

export function useRemoteWebServices(serverId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryKey = remoteWebServicesQueryKey(serverId);

  const query = useFetchQuery({
    queryKey,
    queryFn: async (): Promise<RemoteWebService[]> => {
      if (!client) throw new Error("Host is disconnected");
      const result = await client.listRemoteWebServices();
      if (result.error) throw new Error(result.error);
      return result.services ?? [];
    },
    enabled: Boolean(enabled && client && isConnected),
    dataShape: "list",
    staleTimeMs: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: async (input: { name: string; target: RemoteWebServiceTarget }) => {
      if (!client) throw new Error("Host is disconnected");
      const result = await client.createRemoteWebService(input);
      if (result.error) throw new Error(result.error);
      if (!result.service) throw new Error("Host returned no Remote Web Service");
      return result.service;
    },
    onSuccess: (service) => {
      queryClient.setQueryData<RemoteWebService[]>(queryKey, (current = []) => [
        ...current.filter((item) => item.id !== service.id),
        service,
      ]);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) throw new Error("Host is disconnected");
      const result = await client.removeRemoteWebService(id);
      if (result.error) throw new Error(result.error);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<RemoteWebService[]>(queryKey, (current = []) =>
        current.filter((service) => service.id !== id),
      );
    },
  });

  return {
    services: query.data ?? [],
    isConnected,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    createService: createMutation.mutateAsync,
    removeService: removeMutation.mutateAsync,
    isCreating: createMutation.isPending,
    removingId: removeMutation.isPending ? (removeMutation.variables ?? null) : null,
  };
}
