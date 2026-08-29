import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

// Everything the pin toggle actually needs. Kept narrower than SidebarWorkspaceEntry so the
// global keyboard handler can build one from the active route selection without a sidebar row.
export type PinnableWorkspace = Pick<
  SidebarWorkspaceEntry,
  "serverId" | "workspaceId" | "workspaceKey" | "pinnedAt"
>;

export type ToggleSidebarWorkspacePin = (workspace: PinnableWorkspace) => void;

// Module scope, not a per-hook ref: the sidebar row menus and the global keyboard shortcut each
// hold their own controller instance, and a per-instance guard would let a keypress and a menu
// click fire two concurrent, opposite setWorkspacePinned calls for the same workspace.
const pendingWorkspaceKeys = new Set<string>();

// The in-flight guard is pure so the controller's concurrency contract can be unit-tested
// without a React renderer: a second toggle for a pending key is a no-op, and the key stays
// claimed until the mutation settles (success or failure alike).
export function beginSidebarPinToggle(workspaceKey: string): boolean {
  if (pendingWorkspaceKeys.has(workspaceKey)) {
    return false;
  }
  pendingWorkspaceKeys.add(workspaceKey);
  return true;
}

export function endSidebarPinToggle(workspaceKey: string): void {
  pendingWorkspaceKeys.delete(workspaceKey);
}

export function useSidebarWorkspacePinController(): ToggleSidebarWorkspacePin {
  const { t } = useTranslation();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async ({
      workspace,
      pinned,
    }: {
      workspace: PinnableWorkspace;
      pinned: boolean;
    }) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspacePinned(workspace.workspaceId, pinned);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
    onSettled: (_data, _error, { workspace }) => {
      endSidebarPinToggle(workspace.workspaceKey);
    },
  });
  const mutate = mutation.mutate;

  return useCallback(
    (workspace: PinnableWorkspace) => {
      if (!beginSidebarPinToggle(workspace.workspaceKey)) {
        return;
      }
      mutate({ workspace, pinned: workspace.pinnedAt == null });
    },
    [mutate],
  );
}
