import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RemoteWebService, RemoteWebServiceTarget } from "@bytetrue/byspace-protocol/messages";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";

export function remoteWebServicesQueryKey(serverId: string) {
  return ["remoteWebServices", serverId] as const;
}

export function useRemoteWebServices(
  serverId: string,
  enabled: boolean,
  sourceDaemonPublicKeyB64?: string,
) {
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
      if (!client || !sourceDaemonPublicKeyB64) throw new Error("Source host is disconnected");
      const targetClient = getHostRuntimeStore().getClient(input.target.serverId);
      if (!targetClient) throw new Error("Target host is disconnected");
      const result = await client.createRemoteWebService(input);
      if (result.error) throw new Error(result.error);
      if (!result.service) throw new Error("Host returned no Remote Web Service");
      try {
        const grant = await targetClient.grantRemoteWebService({
          serviceId: result.service.id,
          sourceDaemonPublicKeyB64,
          targetPort: input.target.port,
        });
        if (grant.error) throw new Error(grant.error);
      } catch (error) {
        const rollback = await client.removeRemoteWebService(result.service.id).catch(() => null);
        if (!rollback || rollback.error) {
          void queryClient.invalidateQueries({ queryKey });
          throw new Error(
            `Target authorization failed and the source mapping could not be rolled back: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        throw error;
      }
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
    mutationFn: async (service: RemoteWebService) => {
      if (!client) throw new Error("Source host is disconnected");
      const targetClient = getHostRuntimeStore().getClient(service.target.serverId);
      if (!targetClient) throw new Error("Target host is disconnected");
      const revoke = await targetClient.revokeRemoteWebServiceGrant(service.id);
      if (revoke.error) throw new Error(revoke.error);
      const result = await client.removeRemoteWebService(service.id);
      if (result.error) throw new Error(result.error);
      return service.id;
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
    removingId: removeMutation.isPending ? (removeMutation.variables?.id ?? null) : null,
  };
}
