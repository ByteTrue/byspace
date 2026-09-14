import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
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
    <View style={styles.hostRow}>
      <View style={styles.hostInfo}>
        <HostStatusDot serverId={host.serverId} />
        <Text style={styles.hostName} numberOfLines={1}>
          {hostName}
        </Text>
      </View>
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
    </View>
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
      <View style={styles.body}>
        <Text style={styles.promptText}>
          {t("sidebar.project.confirmations.removeMultiHostPrompt", { projectName })}
        </Text>
        <Text style={styles.noteText}>{t("sidebar.project.confirmations.removeNote")}</Text>

        <View style={styles.hostList}>
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
        </View>

        <View style={styles.actions}>
          <Button
            variant="destructive"
            size="md"
            loading={pendingServerId === "all"}
            disabled={isPending}
            onPress={handleRemoveAllHostsVoid}
            style={styles.allHostsButton}
            testID="project-remove-all-hosts-button"
          >
            {t("sidebar.project.confirmations.removeFromAllHosts")}
          </Button>

          <Button
            variant="secondary"
            size="md"
            disabled={isPending}
            onPress={handleModalClose}
            style={styles.cancelButton}
            testID="project-remove-cancel-button"
          >
            {t("sidebar.project.confirmations.cancel")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  promptText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "500",
  },
  noteText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  hostList: {
    gap: theme.spacing[2],
    marginVertical: theme.spacing[1],
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surface0,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  hostInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
  },
  hostName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "500",
    flexShrink: 1,
  },
  actions: {
    flexDirection: "column",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  allHostsButton: {
    width: "100%",
  },
  cancelButton: {
    width: "100%",
  },
}));
