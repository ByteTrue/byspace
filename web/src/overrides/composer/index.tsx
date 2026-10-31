// Override of packages/app/src/composer/index.tsx.
// shortcut: batch 3 of step 3 ports the composer (model, mode and thinking pickers, attachments,
// slash commands, @ files, queued messages, dictation). Until then callers get step 1's text box
// behind the same props: the draft text, send/steer/interrupt and stop are wired, nothing else.
import { useCallback } from "react";
import type { UserComposerAttachment, WorkspaceComposerAttachment } from "@/attachments/types";
import type { ClientSlashCommand } from "@/client-slash-commands";
import type { TextReplacement } from "@/composer/types";
import { AgentComposer } from "~/agent/agent-composer";

type AttachmentListUpdater =
  | UserComposerAttachment[]
  | ((current: UserComposerAttachment[]) => UserComposerAttachment[]);

export interface ComposerProps {
  agentId: string;
  serverId: string;
  workspaceId?: string | null;
  isPaneFocused: boolean;
  value: string;
  onChangeText: (text: string) => void;
  textReplacement: TextReplacement;
  attachments: UserComposerAttachment[];
  attachmentScopeKeys?: readonly string[];
  onOpenWorkspaceAttachment?: (attachment: WorkspaceComposerAttachment) => void;
  onChangeAttachments: (updater: AttachmentListUpdater) => void;
  cwd: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  autoFocus?: boolean;
  autoFocusKey?: string;
  isSubmitLoading?: boolean;
  externalKeyboardShift?: boolean;
  isCompactLayout?: boolean;
  onMessageSent?: () => void;
  onComposerHeightChange?: (height: number) => void;
  onAttentionInputFocus?: () => void;
  onAttentionPromptSend?: () => void;
  onClientSlashCommand?: (command: ClientSlashCommand) => Promise<void>;
}

export function Composer({
  agentId,
  serverId,
  value,
  onChangeText,
  clearDraft,
  onMessageSent,
  onAttentionPromptSend,
}: ComposerProps) {
  const handleSent = useCallback(() => {
    clearDraft("sent");
    onMessageSent?.();
    onAttentionPromptSend?.();
  }, [clearDraft, onAttentionPromptSend, onMessageSent]);
  return (
    <AgentComposer
      serverId={serverId}
      agentId={agentId}
      value={value}
      onChangeText={onChangeText}
      onSent={handleSent}
    />
  );
}
