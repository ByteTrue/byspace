import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  prepareWorkspaceTab as prepareWorkspaceTabPure,
  type PrepareWorkspaceTabInput,
} from "../utils/prepare-workspace-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type { PrepareWorkspaceTabInput } from "../utils/prepare-workspace-tab";

function layoutStoreDeps() {
  const store = useWorkspaceLayoutStore.getState();
  return {
    openTab: (input: {
      workspaceKey: string;
      target: WorkspaceTabTarget;
      intent: "reveal";
      pin?: boolean;
      placement?: import("@/stores/workspace-layout-actions").WorkspaceTabPlacement;
    }) => store.openTab(input),
  };
}

export function prepareWorkspaceTab(input: PrepareWorkspaceTabInput): void {
  prepareWorkspaceTabPure(input, layoutStoreDeps());
}
