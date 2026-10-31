// Override of packages/app/src/projects/project-remove-modal.tsx: removing a project that lives on
// several hosts, from one host or from all, on shadcn's Dialog. Same flow and testIDs.
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import {
  getCurrentProjectRemoveReadinessForTargets,
  removeProjectFromHosts,
} from "@/projects/project-remove";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { HostStatusDot } from "~/components/host-status-dot";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";

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

function HostRemoveRow({
  host,
  hostName,
  isPending,
  isRowPending,
  onRemove,
}: {
  host: ProjectRemoveModalHostItem;
  hostName: string;
  isPending: boolean;
  isRowPending: boolean;
  onRemove: (host: ProjectRemoveModalHostItem) => void;
}) {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onRemove(host), [host, onRemove]);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <HostStatusDot serverId={host.serverId} />
      <span className="min-w-0 flex-1 truncate text-sm">{hostName}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={handleClick}
        data-testid={`project-remove-host-button-${host.serverId}`}
      >
        {isRowPending ? <Spinner /> : null}
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
  const hostNames = useMemo(
    () => new Map(allHosts.map((host) => [host.serverId, host.label])),
    [allHosts],
  );
  const isPending = pendingServerId !== null;

  const remove = useCallback(
    async (targets: readonly ProjectRemoveModalHostItem[], pendingKey: string) => {
      setPendingServerId(pendingKey);
      try {
        const readiness = getCurrentProjectRemoveReadinessForTargets(
          targets.map((host) => ({ serverId: host.serverId, projectId: host.projectId })),
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
    },
    [onClose, t, toast],
  );

  const removeFromHost = useCallback(
    (host: ProjectRemoveModalHostItem) => void remove([host], host.serverId),
    [remove],
  );
  const removeFromAllHosts = useCallback(() => void remove(hosts, "all"), [hosts, remove]);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isPending) onClose();
    },
    [isPending, onClose],
  );

  return (
    <Dialog open={visible} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid={testID ?? `project-remove-modal-${projectViewKey}`}
      >
        <DialogHeader>
          <DialogTitle>{t("sidebar.project.confirmations.removeMultiHostTitle")}</DialogTitle>
          <DialogDescription>
            {t("sidebar.project.confirmations.removeMultiHostPrompt", { projectName })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("sidebar.project.confirmations.removeNote")}
        </p>
        <div className="flex flex-col divide-y rounded-lg border">
          {hosts.map((host) => {
            const hostName = hostNames.get(host.serverId) ?? host.serverId;
            return (
              <HostRemoveRow
                key={host.serverId}
                host={host}
                hostName={hostName}
                isPending={isPending}
                isRowPending={pendingServerId === host.serverId}
                onRemove={removeFromHost}
              />
            );
          })}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={onClose}
            data-testid="project-remove-cancel-button"
          >
            {t("sidebar.project.confirmations.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={removeFromAllHosts}
            data-testid="project-remove-all-hosts-button"
          >
            {pendingServerId === "all" ? <Spinner /> : null}
            {t("sidebar.project.confirmations.removeFromAllHosts")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
