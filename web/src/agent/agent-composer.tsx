import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cancelComposerAgent, dispatchComposerAgentMessage } from "@/composer/actions";
import { resolveActiveSendBehavior } from "@/composer/input/state";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useToast } from "@/contexts/toast-context";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { encodeImages } from "@/utils/encode-images";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "~/components/ui/input-group";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AgentComposer({
  serverId,
  agentId,
  value,
  onChangeText,
  onSent,
}: {
  serverId: string;
  agentId: string;
  /** Controlled text (the agent's draft); without it the box keeps its own. */
  value?: string;
  onChangeText?: (text: string) => void;
  /** After a message is handed to the daemon; a controlled caller clears its draft here. */
  onSent?: () => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { settings } = useAppSettings();
  const toast = useToast();
  const [ownText, setOwnText] = useState("");
  const text = value ?? ownText;
  const setText = onChangeText ?? setOwnText;
  const isRunning = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isActive,
  );
  const isCancelling = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isCancelling,
  );
  // Same rule as the Expo composer: a turn parked on a permission prompt is interrupted, not steered.
  const hasPendingPermission = useSessionStore((state) => {
    for (const permission of state.sessions[serverId]?.pendingPermissions.values() ?? []) {
      if (permission.agentId === agentId) return true;
    }
    return false;
  });
  const canSend = text.trim().length > 0 && Boolean(client) && isConnected;

  const send = useCallback(async () => {
    if (!client || !canSend) return;
    const message = text;
    if (onSent) onSent();
    else setText("");
    let activeTurnBehavior: "steer" | "interrupt" | undefined;
    if (isRunning) {
      activeTurnBehavior =
        resolveActiveSendBehavior(settings.sendBehavior, hasPendingPermission) === "steer"
          ? "steer"
          : "interrupt";
    }
    const turnId =
      activeTurnBehavior === "steer"
        ? selectAgentTurnPresentation(useSessionStore.getState().sessions[serverId], agentId).turnId
        : null;
    try {
      await dispatchComposerAgentMessage({
        client,
        agentId,
        text: message,
        attachments: [],
        encodeImages,
        submission: createMessageSubmissionWriter(serverId),
        activeTurnBehavior,
        activeTurnId: turnId ?? undefined,
      });
    } catch (error) {
      setText(message);
      toast.error(errorMessage(error));
    }
  }, [
    agentId,
    canSend,
    client,
    hasPendingPermission,
    isRunning,
    onSent,
    serverId,
    setText,
    settings.sendBehavior,
    text,
    toast,
  ]);

  const stop = useCallback(() => {
    cancelComposerAgent({
      client,
      agentId,
      isAgentRunning: isRunning,
      isCancellingAgent: isCancelling,
      isConnected,
    })?.catch((error: unknown) => toast.error(errorMessage(error)));
  }, [agentId, client, isCancelling, isConnected, isRunning, toast]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setText(event.target.value);
    },
    [setText],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void send();
      }
    },
    [send],
  );

  const handleSendClick = useCallback(() => {
    void send();
  }, [send]);

  return (
    <div className="mx-auto w-full max-w-[820px] shrink-0 px-4 pb-4">
      {/* BySpace: the composer is focused nearly all the time, so focus only darkens the border.
          The disabled send button must not grey out the whole group (InputGroup dims on any
          disabled descendant). */}
      <InputGroup className="rounded-xl has-disabled:bg-transparent has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:has-disabled:bg-input/30">
        <InputGroupTextarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message the agent…"
          className="max-h-60 min-h-12"
        />
        <InputGroupAddon align="block-end" className="justify-end">
          {isRunning ? (
            <InputGroupButton
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              aria-label="Stop"
              disabled={isCancelling}
              onClick={stop}
            >
              <Square className="fill-current" />
            </InputGroupButton>
          ) : null}
          <InputGroupButton
            variant="default"
            size="icon-sm"
            className="rounded-full"
            aria-label="Send"
            disabled={!canSend}
            onClick={handleSendClick}
          >
            <ArrowUp />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
