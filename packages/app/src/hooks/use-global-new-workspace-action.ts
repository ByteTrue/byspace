import { useCallback } from "react";
import { router } from "expo-router";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useHosts } from "@/runtime/host-runtime";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";

const WORKSPACE_NEW_ACTIONS: readonly KeyboardActionId[] = ["workspace.new"];

export function useGlobalNewWorkspaceAction() {
  const hosts = useHosts();

  // Route without a host: the screen resolver owns the initial host. A known route serverId
  // would bypass that chain, so this entry must not carry the active workspace's host.
  // The dispatcher gates on enabled, so handle needs no hosts guard of its own.
  const handle = useCallback(() => {
    router.navigate(buildNewWorkspaceRoute() as never);
    return true;
  }, []);

  useKeyboardActionHandler({
    handlerId: "workspace-new-global",
    actions: WORKSPACE_NEW_ACTIONS,
    enabled: hosts.length > 0,
    priority: 0,
    handle,
  });
}
