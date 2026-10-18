import { useCallback } from "react";
import { openChiefWorkspace, useChiefAvailable } from "@/chief/home-workspace";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";

const CHIEF_OPEN_ACTIONS: readonly KeyboardActionId[] = ["chief.open"];

export function useGlobalChiefAction(pathname?: string | null) {
  const chiefAvailable = useChiefAvailable();

  const handle = useCallback(() => {
    void openChiefWorkspace(pathname);
    return true;
  }, [pathname]);

  useKeyboardActionHandler({
    handlerId: "chief-open-global",
    actions: CHIEF_OPEN_ACTIONS,
    enabled: chiefAvailable,
    priority: 0,
    handle,
  });
}
