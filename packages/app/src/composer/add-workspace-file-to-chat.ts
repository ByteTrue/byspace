import type { WorkspaceFileComposerAttachment } from "@/attachments/types";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useDraftStore } from "@/stores/draft-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

export async function addWorkspaceFileToFocusedChat(input: {
  serverId: string;
  workspaceId: string;
  attachment: WorkspaceFileComposerAttachment;
}): Promise<boolean> {
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (!workspaceKey) return false;
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  const target = resolveFocusedChatTarget({ serverId: input.serverId, layout });
  if (!target) return false;
  await useDraftStore.getState().attachWorkspaceFile({
    draftKey: target.draftKey,
    attachment: input.attachment,
  });
  useWorkspaceLayoutStore.getState().focusTab(workspaceKey, target.tabId);
  return true;
}
