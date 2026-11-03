// Port of archive/expo-app:packages/app/src/projects/project-remove-modal.tsx: removing a multi-host project from one host or all, on AdaptiveModalSheet; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/project-remove-modal.py; edit it directly.
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { HostStatusDot } from "@/components/host-status-dot";
import { useToast } from "@/contexts/toast-context";
import { useHosts, getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  getCurrentProjectRemoveReadinessForTargets,
  removeProjectFromHosts,
} from "@/projects/project-remove";

export interface ProjectRemoveModalHostItem {
  serverId: string;
  projectId: string;
}

export interface ProjectRemoveModalProps {
  visible: boolean;
  projectName: string;
  projectViewKey: string;
  hosts: readonly ProjectRemoveModalHostItem[];
  onClose: () => void;
  testID?: string;
}

interface ProjectRemoveHostRowProps {
  host: ProjectRemoveModalHostItem;
  hostName: string;
  isRowPending: boolean;
  isPending: boolean;
  onRemove: (host: ProjectRemoveModalHostItem) => void;
}

function ProjectRemoveHostRow({
  host,
  hostName,
  isRowPending,
  isPending,
  onRemove,
}: ProjectRemoveHostRowProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onRemove(host);
  }, [host, onRemove]);

  return (
    <div className="flex flex-row items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
      <div className="flex flex-1 flex-row items-center gap-2">
        <HostStatusDot serverId={host.serverId} />
        <span className="shrink truncate text-sm leading-[normal] font-medium text-foreground">
          {hostName}
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={isRowPending}
        disabled={isPending}
        onPress={handlePress}
        testID={`project-remove-host-button-${host.serverId}`}
      >
        {t("sidebar.project.confirmations.removeFromHost", { hostName })}
      </Button>
    </div>
  );
}

export function ProjectRemoveModal({
  visible,
  projectName,
  projectViewKey,
  hosts,
  onClose,
  testID,
}: ProjectRemoveModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const allHosts = useHosts();
  const [pendingServerId, setPendingServerId] = useState<string | "all" | null>(null);

  const hostMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of allHosts) {
      map.set(h.serverId, h.label);
    }
    return map;
  }, [allHosts]);

  const handleRemoveSingleHost = useCallback(
    async (host: ProjectRemoveModalHostItem) => {
      setPendingServerId(host.serverId);
      try {
        const readiness = getCurrentProjectRemoveReadinessForTargets([
          { serverId: host.serverId, projectId: host.projectId },
        ]);
        if (readiness.kind === "needs_host_update") {
          toast.error(t("sidebar.project.toasts.updateHostToRemove"));
          return;
        }

        const outcome = await removeProjectFromHosts({
          targets: readiness.targets,
          getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
        });

        if (outcome.kind === "host_disconnected") {
          toast.error(t("sidebar.project.toasts.hostDisconnected"));
          return;
        }
        if (outcome.kind === "failed") {
          toast.error(t("sidebar.project.toasts.removeFailed"));
          return;
        }
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("sidebar.project.toasts.removeFailed"),
        );
      } finally {
        setPendingServerId(null);
      }
    },
    [onClose, t, toast],
  );

  const handleRemoveAllHosts = useCallback(async () => {
    setPendingServerId("all");
    try {
      const readiness = getCurrentProjectRemoveReadinessForTargets(
        hosts.map((host) => ({ serverId: host.serverId, projectId: host.projectId })),
      );
      if (readiness.kind === "needs_host_update") {
        toast.error(t("sidebar.project.toasts.updateHostToRemove"));
        return;
      }

      const outcome = await removeProjectFromHosts({
        targets: readiness.targets,
        getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
      });

      if (outcome.kind === "host_disconnected") {
        toast.error(t("sidebar.project.toasts.hostDisconnected"));
        return;
      }
      if (outcome.kind === "failed") {
        toast.error(t("sidebar.project.toasts.removeFailed"));
        return;
      }
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.project.toasts.removeFailed"),
      );
    } finally {
      setPendingServerId(null);
    }
  }, [hosts, onClose, t, toast]);

  const sheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("sidebar.project.confirmations.removeMultiHostTitle") }),
    [t],
  );

  const isPending = pendingServerId !== null;

  const handleModalClose = useCallback(() => {
    if (!isPending) {
      onClose();
    }
  }, [isPending, onClose]);

  const handleRemoveSingleHostVoid = useCallback(
    (host: ProjectRemoveModalHostItem) => {
      void handleRemoveSingleHost(host);
    },
    [handleRemoveSingleHost],
  );

  const handleRemoveAllHostsVoid = useCallback(() => {
    void handleRemoveAllHosts();
  }, [handleRemoveAllHosts]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleModalClose}
      header={sheetHeader}
      testID={testID ?? `project-remove-modal-${projectViewKey}`}
    >
      <div className="flex flex-col gap-3 pb-2">
        <span className="text-sm leading-[normal] font-medium text-foreground">
          {t("sidebar.project.confirmations.removeMultiHostPrompt", { projectName })}
        </span>
        <span className="text-xs leading-[normal] text-muted-foreground">
          {t("sidebar.project.confirmations.removeNote")}
        </span>

        <div className="my-1 flex flex-col gap-2">
          {hosts.map((host) => {
            const hostName = hostMap.get(host.serverId) ?? host.serverId;
            const isRowPending = pendingServerId === host.serverId;

            return (
              <ProjectRemoveHostRow
                key={host.serverId}
                host={host}
                hostName={hostName}
                isRowPending={isRowPending}
                isPending={isPending}
                onRemove={handleRemoveSingleHostVoid}
              />
            );
          })}
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <Button
            variant="destructive"
            size="md"
            loading={pendingServerId === "all"}
            disabled={isPending}
            onPress={handleRemoveAllHostsVoid}
            className="w-full"
            testID="project-remove-all-hosts-button"
          >
            {t("sidebar.project.confirmations.removeFromAllHosts")}
          </Button>

          <Button
            variant="secondary"
            size="md"
            disabled={isPending}
            onPress={handleModalClose}
            className="w-full"
            testID="project-remove-cancel-button"
          >
            {t("sidebar.project.confirmations.cancel")}
          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>
  );
}
