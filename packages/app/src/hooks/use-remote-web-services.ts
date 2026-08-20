import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemoteWebService, RemoteWebServiceTarget } from "@bytetrue/byspace-protocol/messages";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeConnectionStatuses,
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryKey = remoteWebServicesQueryKey(serverId);

  const query = useFetchQuery({
    queryKey,
    queryFn: async (): Promise<RemoteWebService[]> => {
      if (!client) {
        throw new Error(t("settings.host.remoteWebServices.sourceDisconnected"));
      }
      const result = await client.listRemoteWebServices();
      if (result.error) throw new Error(result.error);
      return result.services ?? [];
    },
    enabled: Boolean(enabled && client && isConnected),
    dataShape: "list",
    staleTimeMs: 10_000,
  });

  const services = useMemo(() => query.data ?? [], [query.data]);
  const targetServerIds = useMemo(
    () => [...new Set(services.map((service) => service.target.serverId))],
    [services],
  );
  const targetStatuses = useHostRuntimeConnectionStatuses(targetServerIds);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceDaemonPublicKeyB64 || !isConnected) return;
    let cancelled = false;
    void Promise.all(
      services.map(async (service) => {
        if (targetStatuses.get(service.target.serverId) !== "online") return;
        const targetClient = getHostRuntimeStore().getClient(service.target.serverId);
        if (!targetClient) return;
        const result = await targetClient.grantRemoteWebService({
          serviceId: service.id,
          sourceDaemonPublicKeyB64,
          targetPort: service.target.port,
        });
        if (result.error) throw new Error(result.error);
      }),
    ).then(
      () => {
        if (!cancelled) setReconciliationError(null);
        return undefined;
      },
      () => {
        if (!cancelled) {
          setReconciliationError(t("settings.host.remoteWebServices.authorizationRepairFailed"));
        }
        return undefined;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isConnected, services, sourceDaemonPublicKeyB64, t, targetStatuses]);

  const createMutation = useMutation({
    mutationFn: async (input: { name: string; target: RemoteWebServiceTarget }) => {
      if (!client || !sourceDaemonPublicKeyB64) {
        throw new Error(t("settings.host.remoteWebServices.sourceDisconnected"));
      }
      const targetClient = getHostRuntimeStore().getClient(input.target.serverId);
      if (!targetClient) {
        throw new Error(t("settings.host.remoteWebServices.targetDisconnected"));
      }
      const result = await client.createRemoteWebService(input);
      if (result.error) throw new Error(result.error);
      const service = result.service;
      if (!service) {
        throw new Error(t("settings.host.remoteWebServices.missingCreatedService"));
      }
      const rollbackSource = async (cause: unknown): Promise<never> => {
        const rollback = await client.removeRemoteWebService(service.id).catch(() => null);
        if (!rollback || rollback.error) {
          throw new Error(
            t("settings.host.remoteWebServices.authorizationRollbackFailed", {
              message: cause instanceof Error ? cause.message : String(cause),
            }),
            { cause },
          );
        }
        throw cause;
      };

      const grant = await targetClient
        .grantRemoteWebService({
          serviceId: service.id,
          sourceDaemonPublicKeyB64,
          targetPort: input.target.port,
        })
        .catch(async (error: unknown) => {
          const revoke = await targetClient
            .revokeRemoteWebServiceGrant(service.id)
            .catch(() => null);
          if (!revoke || revoke.error) {
            throw new Error(t("settings.host.remoteWebServices.authorizationOutcomeUnknown"), {
              cause: error,
            });
          }
          return await rollbackSource(error);
        });
      if (grant.error) return await rollbackSource(new Error(grant.error));
      return service;
    },
    onSuccess: (service) => {
      queryClient.setQueryData<RemoteWebService[]>(queryKey, (current = []) => [
        ...current.filter((item) => item.id !== service.id),
        service,
      ]);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (service: RemoteWebService) => {
      if (!client) {
        throw new Error(t("settings.host.remoteWebServices.sourceDisconnected"));
      }
      const targetClient = getHostRuntimeStore().getClient(service.target.serverId);
      if (!targetClient) {
        throw new Error(t("settings.host.remoteWebServices.targetDisconnected"));
      }
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
    onError: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    services,
    isConnected,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : reconciliationError,
    createService: createMutation.mutateAsync,
    removeService: removeMutation.mutateAsync,
    isCreating: createMutation.isPending,
    removingId: removeMutation.isPending ? (removeMutation.variables?.id ?? null) : null,
  };
}
