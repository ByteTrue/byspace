import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import type { MessagePayload } from "@/composer/types";
import type { DictationRefinementMeta } from "@/hooks/use-dictation.shared";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";

const CJK_BOUNDARY_START_RE = /^[\p{Script=Han}，。！？、；：“‘「『【（]/u;
const CJK_BOUNDARY_END_RE = /[\p{Script=Han}，。！？、；：”’」』】）]$/u;
const CJK_NO_LEADING_SPACE_RE = /^[，。！？、；：”’」』】）]/u;

export type SendBehavior = "interrupt" | "queue";

export function appendDictationTranscript(draft: string, transcript: string): string {
  if (!transcript) {
    return draft;
  }
  const joinsWithoutSpace =
    !draft ||
    /\s$/.test(draft) ||
    /^\s/.test(transcript) ||
    CJK_NO_LEADING_SPACE_RE.test(transcript) ||
    (CJK_BOUNDARY_END_RE.test(draft) && CJK_BOUNDARY_START_RE.test(transcript));
  return `${draft}${joinsWithoutSpace ? "" : " "}${transcript}`;
}

export interface DictationRefinementChoice {
  originalDraft: string;
  refinedDraft: string;
  showingOriginal: boolean;
}

export function applyDictationRefinement(
  draft: string,
  transcript: string,
  refinement: DictationRefinementMeta | undefined,
): { draft: string; choice: DictationRefinementChoice | null } {
  const originalDraft = appendDictationTranscript(
    draft,
    refinement?.originalText?.trim() || transcript,
  );
  const refinedDraft = appendDictationTranscript(draft, transcript);
  const choice =
    refinement?.originalText && refinedDraft !== originalDraft
      ? { originalDraft, refinedDraft, showingOriginal: false }
      : null;
  return { draft: choice ? refinedDraft : originalDraft, choice };
}

export function toggleDictationRefinement(
  draft: string,
  choice: DictationRefinementChoice,
): { draft: string; choice: DictationRefinementChoice | null } {
  const expectedDraft = choice.showingOriginal ? choice.originalDraft : choice.refinedDraft;
  if (draft !== expectedDraft) {
    return { draft, choice: null };
  }
  const showingOriginal = !choice.showingOriginal;
  return {
    draft: showingOriginal ? choice.originalDraft : choice.refinedDraft,
    choice: { ...choice, showingOriginal },
  };
}

interface SendActionContext {
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  handleSendMessage: () => void;
  handleQueueMessage: () => void;
}

interface MessageInputKeyboardActions {
  focusInput: () => void;
  isDictationRecording: () => boolean;
  isDictationActive: () => boolean;
  confirmDictation: () => void | Promise<void>;
  cancelDictation: () => void | Promise<void>;
  startDictation: () => void | Promise<void>;
}

export function computeCanStartDictation(input: {
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  disabled: boolean;
  dictationUnavailableMessage: string | null | undefined;
}): boolean {
  const socketConnected = input.client?.isConnected ?? false;
  const readyForDictation = input.isReadyForDictation ?? socketConnected;
  return (
    socketConnected && readyForDictation && !input.disabled && !input.dictationUnavailableMessage
  );
}

export function runDefaultSendAction(ctx: SendActionContext): void {
  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.handleQueueMessage();
    return;
  }
  ctx.handleSendMessage();
}

export function runAlternateSendAction(ctx: SendActionContext): void {
  if (ctx.defaultSendBehavior === "queue") {
    ctx.handleSendMessage();
    return;
  }
  if (ctx.isAgentRunning && ctx.onQueue) {
    ctx.handleQueueMessage();
  }
}

export function runMessageInputKeyboardAction(
  action: MessageInputKeyboardActionKind,
  actions: MessageInputKeyboardActions,
): boolean {
  if (action === "focus") {
    actions.focusInput();
    return true;
  }
  if (action === "send" || action === "dictation-confirm") {
    if (actions.isDictationRecording()) {
      void actions.confirmDictation();
      return true;
    }
    return actions.isDictationActive();
  }
  if (action === "dictation-cancel") {
    if (actions.isDictationActive()) {
      void actions.cancelDictation();
      return true;
    }
    return false;
  }
  if (action === "dictation-toggle") {
    if (actions.isDictationRecording()) {
      void actions.confirmDictation();
    } else if (!actions.isDictationActive()) {
      void actions.startDictation();
    }
    return true;
  }
  return false;
}
