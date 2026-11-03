// Port of archive/expo-app:packages/app/src/composer/input/input.tsx. The input logic is the Expo file's (send,
// queue, steer, IME, paste, height, keyboard actions); the view is DOM and Tailwind.
// Converted from the Expo file by archive/expo-app:web/scripts/port/composer-input.py; edit it directly.
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  forwardRef,
} from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "@/styles/theme";
import { ArrowUp, CornerDownLeft, Plus } from "lucide-react";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import {
  collectImageFilesFromClipboardData,
  filesToImageAttachments,
} from "@/utils/image-attachments-from-files";
import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment, MessagePayload, TextReplacement } from "@/composer/types";
import { focusWithRetries } from "@/utils/web-focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Shortcut } from "~/components/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { RenderProfile } from "@/utils/render-profiler";
import { useComposerHeight } from "@/composer/input/height";
import { resolveComposerInputMode, type ComposerInputMode } from "@/composer/input-mode";
import type { NativePastedFile } from "@/composer/native-pasted-image";
import {
  EditingTextInput,
  type EditingTextInputHandle as ComposerTextInputHandle,
} from "@/components/ui/text-input";
import { resolveSendTooltipLabel, resolveSubmitAccessibilityLabel } from "@/composer/input/labels";
import {
  resolveComposerSurfacePresentation,
  runAlternateSendAction,
  runDefaultSendAction,
  runMessageInputKeyboardAction,
} from "@/composer/input/state";
import { useWindowDimensions } from "~/hooks/use-window-dimensions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";

type ShortcutChord = NonNullable<React.ComponentProps<typeof Shortcut>["chord"]>;

const DEFAULT_SEND_KEYS: ShortcutKey[][] = [["Enter"]];

export interface AttachmentMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  icon?: React.ReactElement | null;
}

export interface ComposerInputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

export interface ComposerKeyPressEvent {
  key: string;
  preventDefault: () => void;
  input: ComposerInputSnapshot;
}

export interface MessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the submit button stays visible and can submit even with no content. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  /** Optional testID for the primary submit button. */
  submitButtonTestID?: string;
  submitIcon?: "arrow" | "return";
  isSubmitDisabled?: boolean;
  isSubmitLoading?: boolean;
  /** When true, keep the grown input height after submit (text is preserved, not cleared). */
  preserveHeightOnSubmit?: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef?: (node: HTMLElement | null) => void;
  onAddImages?: (images: ImageAttachment[]) => void;
  onPasteImages?: (files: readonly NativePastedFile[]) => void;
  client: DaemonClient | null;
  placeholder?: string;
  autoFocus?: boolean;
  autoFocusKey?: string;
  disabled?: boolean;
  /** Content to render on the left side of the composer toolbar (e.g., AgentControls) */
  leftContent?: React.ReactNode;
  /** Auxiliary content to render on the right side after the voice button. */
  rightContent?: React.ReactNode;
  /** Primary action to render when the agent is active and the composer has no sendable content. */
  activeActionContent?: React.ReactNode;
  /** When true and there's sendable content, calls onQueue instead of onSubmit */
  isAgentRunning?: boolean;
  /** Controls what the default send action (Enter, send button) does when the agent is
   *  running. "interrupt" and "steer" send immediately, "queue" queues. Required so the default
   *  lives only in DEFAULT_CLIENT_SETTINGS. */
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  /** Callback for queue button when agent is running */
  onQueue?: (payload: MessagePayload) => void;
  /** Optional handler used when submit button is in loading state. */
  onSubmitLoadingPress?: () => void;
  /** Intercept key press events before default handling. Return true to prevent default. */
  onKeyPress?: (event: ComposerKeyPressEvent) => boolean;
  /** Reports cursor selection updates from the underlying input. */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onFocusChange?: (focused: boolean) => void;
  onHeightChange?: (height: number) => void;
  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: CSSProperties;
  /** Content rendered inside the bordered input surface, above the text input (e.g. attachment pills). */
  attachmentSlot?: React.ReactNode;
  /** What this composer is for. See `@/composer/input-mode` for what each mode implies. */
  inputMode?: ComposerInputMode;
  /** Renders `value` as static text on the same surface, for content there is nothing to type into. */
  readOnly?: boolean;
  /** Command issued when application state must replace native-owned text. */
  textReplacement: TextReplacement;
  /** Replaces the submit icon with this label, still inside the composer's own toolbar row. */
  submitLabel?: string;
}

export interface MessageInputRef {
  focus: () => void;
  blur: () => void;
  getText: () => string;
  getInputSnapshot: () => ComposerInputSnapshot;
  replaceText: (text: string, selection?: { start: number; end: number }) => void;
  runKeyboardAction: (action: MessageInputKeyboardActionKind) => boolean;
  /**
   * Web-only: return the underlying DOM element for focus assertions/retries.
   * May return null if not mounted or on native.
   */
  getNativeElement?: () => HTMLElement | null;
}

const MIN_INPUT_HEIGHT = 46;
const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;
const READ_ONLY_STYLE: CSSProperties = { minHeight: MIN_INPUT_HEIGHT };
type WebTextInputKeyPressEvent = ReactKeyboardEvent<HTMLInputElement & HTMLTextAreaElement>;

interface TextAreaHandle {
  scrollHeight?: number;
  clientHeight?: number;
  offsetHeight?: number;
  scrollTop?: number;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  style?: {
    height?: string;
    overflowY?: string;
  } & Record<string, unknown>;
}

function AttachButtonIcon({
  onAttachButtonRef,
  buttonIconSize,
}: {
  onAttachButtonRef: ((node: HTMLElement | null) => void) | undefined;
  buttonIconSize: number;
}) {
  return (
    <span ref={onAttachButtonRef} className="flex size-7 items-center justify-center">
      <Plus size={buttonIconSize} />
    </span>
  );
}

function AttachmentMenuList({ items }: { items: AttachmentMenuItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          data-testid={`message-input-attachment-menu-item-${item.id}`}
          disabled={item.disabled}
          onSelect={item.onSelect}
        >
          {item.icon ?? null}
          {item.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function AttachmentDropdown({
  visible,
  isConnected,
  disabled,
  renderAttachButtonIcon,
  attachmentMenuItems,
  addAttachmentLabel,
}: {
  visible: boolean;
  isConnected: boolean;
  disabled: boolean;
  renderAttachButtonIcon: React.ReactElement;
  attachmentMenuItems: AttachmentMenuItem[];
  addAttachmentLabel: string;
}) {
  const isButtonDisabled = !isConnected || disabled;
  if (!visible) return null;
  return (
    <DropdownMenu>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={isButtonDisabled}
            aria-label={addAttachmentLabel}
            data-testid="message-input-attach-button"
            className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {renderAttachButtonIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {addAttachmentLabel}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        data-testid="message-input-attachment-menu"
        className="w-max min-w-[220px]"
        onCloseAutoFocus={keepFocusElsewhere}
      >
        <AttachmentMenuList items={attachmentMenuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SendTooltipBody({
  label,
  sendKeys,
}: {
  label: string;
  sendKeys: ShortcutChord | null | undefined;
}) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      {sendKeys ? <Shortcut chord={sendKeys} /> : null}
    </span>
  );
}

function SendButtonContent({
  isSubmitLoading,
  submitIcon,
  submitLabel,
  buttonIconSize,
}: {
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  submitLabel: string | undefined;
  buttonIconSize: number;
}) {
  if (isSubmitLoading) return <Spinner className="size-3.5" />;
  if (submitLabel) return <span className="text-sm font-medium">{submitLabel}</span>;
  if (submitIcon === "return") return <CornerDownLeft size={buttonIconSize} />;
  return <ArrowUp size={buttonIconSize} />;
}

interface DesktopKeyPressContext {
  onKeyPressCallback: ((event: ComposerKeyPressEvent) => boolean) | undefined;
  input: ComposerKeyPressEvent["input"];
  submitOnEnter: boolean;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  disabled: boolean;
  handleAlternateSendAction: () => void;
  handleDefaultSendAction: () => void;
}

function handleDesktopKeyPressImpl(
  event: WebTextInputKeyPressEvent,
  ctx: DesktopKeyPressContext,
): void {
  if (isImeComposingKeyboardEvent(event.nativeEvent)) return;

  if (ctx.onKeyPressCallback) {
    const handled = ctx.onKeyPressCallback({
      key: event.nativeEvent.key,
      preventDefault: () => event.preventDefault(),
      input: ctx.input,
    });
    if (handled) return;
  }

  const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;

  if (event.nativeEvent.key !== "Enter") return;
  if (!ctx.submitOnEnter) return;
  if (shiftKey) return;

  if ((metaKey || ctrlKey) && ctx.isAgentRunning && ctx.onQueue) {
    if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
    event.preventDefault();
    ctx.handleAlternateSendAction();
    return;
  }

  if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
  event.preventDefault();
  ctx.handleDefaultSendAction();
}

function getTextInputNativeElement(current: ComposerTextInputHandle | null): HTMLElement | null {
  if (!current) return null;
  const native = typeof current.getNativeRef === "function" ? current.getNativeRef() : current;
  return native instanceof HTMLElement ? native : null;
}

interface PasteImagesEffectArgs {
  getWebTextArea: () => TextAreaHandle | null;
  isConnected: boolean;
  disabled: boolean;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
}

function usePasteImagesEffect(args: PasteImagesEffectArgs): void {
  const { getWebTextArea, isConnected, disabled, onAddImages } = args;

  useEffect(() => {
    if (!onAddImages) return;

    const textarea = getWebTextArea() as
      | (TextAreaHandle & {
          addEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
          removeEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
        })
      | null;
    if (
      !textarea ||
      typeof textarea.addEventListener !== "function" ||
      typeof textarea.removeEventListener !== "function"
    ) {
      return;
    }

    let disposed = false;
    const handlePaste = (event: ClipboardEvent) => {
      if (!isConnected || disabled) return;

      const imageFiles = collectImageFilesFromClipboardData(event.clipboardData);
      if (imageFiles.length === 0) return;

      event.preventDefault();

      void filesToImageAttachments(imageFiles)
        .then((pastedAttachments) => {
          if (disposed || pastedAttachments.length === 0) return;
          onAddImages(pastedAttachments);
          return;
        })
        .catch((error) => {
          console.error("[MessageInput] Failed to process pasted images:", error);
        });
    };

    textarea.addEventListener("paste", handlePaste);
    return () => {
      disposed = true;
      textarea.removeEventListener?.("paste", handlePaste);
    };
  }, [disabled, getWebTextArea, isConnected, onAddImages]);
}

function useAutoFocusOnWebEffect(
  textInputRef: React.MutableRefObject<ComposerTextInputHandle | null>,
  autoFocus: boolean,
  autoFocusKey: string | undefined,
): void {
  useEffect(() => {
    if (!autoFocus) return;
    return focusWithRetries({
      focus: () => textInputRef.current?.focus(),
      isFocused: () => {
        const element = getTextInputNativeElement(textInputRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        return Boolean(element) && active === element;
      },
      deferInitialAttempt: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusKey]);
}

function MessageInputAutoFocus({
  enabled,
  autoFocusKey,
  textInputRef,
}: {
  enabled: boolean;
  autoFocusKey: string | undefined;
  textInputRef: React.MutableRefObject<ComposerTextInputHandle | null>;
}) {
  const { isActiveComposer } = useComposerKeyboardScope();
  useAutoFocusOnWebEffect(textInputRef, enabled && isActiveComposer, autoFocusKey);
  return null;
}

function FocusHint({
  visible,
  focusInputKeys,
  label,
}: {
  visible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  label: string;
}) {
  const { isActiveComposer } = useComposerKeyboardScope();
  if (!isActiveComposer || !visible || !focusInputKeys || !label.trim()) return null;
  return (
    <span className="pointer-events-none absolute top-0 right-0 text-xs text-muted-foreground opacity-50">
      {label}
    </span>
  );
}

interface ComposerTextSurfaceProps {
  readOnly: boolean;
  value: string;
  textInputRef: React.Ref<ComposerTextInputHandle>;
  textInputClassName: string;
  textInputStyle: CSSProperties;
  placeholder: string;
  accessibilityLabel: string;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  editable: boolean;
  autoFocus: boolean;
  onKeyPress: ((event: WebTextInputKeyPressEvent) => void) | undefined;
  onSelectionChange: (selection: { start: number; end: number }) => void;
  onPasteImages: ((files: readonly NativePastedFile[]) => void) | undefined;
  onPasteError: (message: string) => void;
  focusHintVisible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  focusHintLabel: string;
}

/**
 * The composer's content: an editable input, or static text when there is
 * nothing to type. Both sit in the same bordered surface, so read-only is a
 * state of this composer rather than a second one.
 */
function ComposerTextSurface(props: ComposerTextSurfaceProps): React.ReactElement {
  if (props.readOnly) {
    return (
      <div className="relative shrink">
        <p
          className={cn(props.textInputClassName, "text-muted-foreground")}
          style={READ_ONLY_STYLE}
          data-testid="composer-readonly-content"
        >
          {props.value}
        </p>
      </div>
    );
  }
  return (
    <div className="relative flex shrink flex-col">
      <EditingTextInput
        ref={props.textInputRef}
        data-composer-input=""
        initialValue={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        accessibilityLabel={props.accessibilityLabel}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        className={props.textInputClassName}
        style={props.textInputStyle}
        multiline
        rows={1}
        editable={props.editable}
        onKeyDown={props.onKeyPress}
        onSelectionChange={props.onSelectionChange}
        onPasteImages={props.onPasteImages}
        onPasteError={props.onPasteError}
        autoFocus={props.autoFocus}
      />
      <FocusHint
        visible={props.focusHintVisible}
        focusInputKeys={props.focusInputKeys}
        label={props.focusHintLabel}
      />
    </div>
  );
}

function SendButtonTooltip({
  shouldShow,
  canPressLoadingButton,
  onSubmitLoadingPress,
  onDefaultSendAction,
  isSendButtonDisabled,
  submitAccessibilityLabel,
  sendButtonClassName,
  isSubmitLoading,
  submitIcon,
  submitLabel,
  submitButtonTestID,
  buttonIconSize,
  sendKeys,
  sendTooltipLabel,
}: {
  shouldShow: boolean;
  canPressLoadingButton: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  onDefaultSendAction: () => void;
  isSendButtonDisabled: boolean;
  submitAccessibilityLabel: string;
  sendButtonClassName: string;
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  submitLabel: string | undefined;
  submitButtonTestID: string | undefined;
  buttonIconSize: number;
  sendKeys: ShortcutChord | null | undefined;
  sendTooltipLabel: string;
}) {
  if (!shouldShow) return null;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={canPressLoadingButton ? onSubmitLoadingPress : onDefaultSendAction}
          disabled={isSendButtonDisabled}
          aria-label={submitAccessibilityLabel}
          data-testid={submitButtonTestID}
          className={sendButtonClassName}
        >
          <SendButtonContent
            isSubmitLoading={isSubmitLoading}
            submitIcon={submitIcon}
            submitLabel={submitLabel}
            buttonIconSize={buttonIconSize}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <SendTooltipBody label={sendTooltipLabel} sendKeys={sendKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

type PrimaryActionKind = "send" | "active" | "none";

function hasSendableComposerContent(input: {
  hasText: boolean;
  attachments: readonly ComposerAttachment[];
  hasExternalContent: boolean;
}): boolean {
  return input.hasText || input.attachments.length > 0 || input.hasExternalContent;
}

function resolvePrimaryActionKind(input: {
  hasSendableContent: boolean;
  allowEmptySubmit: boolean;
  isAgentRunning: boolean;
  isSubmitLoading: boolean;
}): PrimaryActionKind {
  if (input.hasSendableContent || input.allowEmptySubmit) return "send";
  if (input.isAgentRunning) return "active";
  // The send button stays in place when there is nothing to send; it is disabled instead.
  return "send";
}

function PrimaryAction({
  kind,
  activeActionContent,
  ...sendButtonProps
}: {
  kind: PrimaryActionKind;
  activeActionContent: React.ReactNode;
} & React.ComponentProps<typeof SendButtonTooltip>) {
  if (kind === "active") return activeActionContent;
  if (kind === "send") return <SendButtonTooltip {...sendButtonProps} />;
  return null;
}
interface SendMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  cwd: string;
  isAgentRunning: boolean;
  onSubmit: (payload: MessagePayload) => void;
  onMinimizeHeight: () => void;
  preserveHeightOnSubmit: boolean;
}

function sendMessageImpl(ctx: SendMessageContext): void {
  const trimmed = ctx.value.trim();
  if (
    !trimmed &&
    ctx.attachments.length === 0 &&
    !ctx.hasExternalContent &&
    !ctx.allowEmptySubmit
  ) {
    return;
  }
  ctx.onSubmit({
    text: trimmed,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
  // When the host preserves and locks the composer (e.g. new-workspace creation),
  // the text stays put — collapsing the height would clip it. Keep it grown.
  if (!ctx.preserveHeightOnSubmit) {
    ctx.onMinimizeHeight();
  }
}

interface QueueMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  cwd: string;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  replaceText: (text: string) => void;
  onMinimizeHeight: () => void;
}

function queueMessageImpl(ctx: QueueMessageContext): void {
  if (!ctx.onQueue) return;
  const trimmed = ctx.value.trim();
  if (!trimmed && ctx.attachments.length === 0) return;
  ctx.onQueue({ text: trimmed, attachments: ctx.attachments, cwd: ctx.cwd });
  ctx.replaceText("");
  ctx.onMinimizeHeight();
}

function resolveMaxInputHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}

function isTextAreaLike(v: unknown): v is TextAreaHandle {
  return typeof v === "object" && v !== null && "scrollHeight" in v;
}

function getWebTextAreaImpl(current: ComposerTextInputHandle | null): TextAreaHandle | null {
  if (!current) return null;
  const candidate = current as { getNativeRef?: () => unknown };
  if (typeof candidate.getNativeRef === "function") {
    const native = candidate.getNativeRef();
    if (isTextAreaLike(native)) return native;
  }
  if (isTextAreaLike(current)) return current;
  return null;
}

function getComposerInputSnapshot(
  current: ComposerTextInputHandle | null,
  fallbackText: string,
  fallbackSelection: ComposerInputSnapshot["selection"],
): ComposerInputSnapshot {
  const text = current?.getText() ?? fallbackText;
  const textArea = getWebTextAreaImpl(current);
  const start = textArea?.selectionStart ?? fallbackSelection.start;
  const end = textArea?.selectionEnd ?? fallbackSelection.end;
  return { text, selection: { start, end } };
}

interface SendButtonStateInput {
  disabled: boolean;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  hasSendableContent: boolean;
  allowEmptySubmit: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  isAgentRunning: boolean;
}

interface SendButtonStateOutput {
  canPressLoadingButton: boolean;
  isSendButtonDisabled: boolean;
  defaultActionQueues: boolean;
}

function computeSendButtonState(input: SendButtonStateInput): SendButtonStateOutput {
  const canPressLoadingButton =
    input.isSubmitLoading && typeof input.onSubmitLoadingPress === "function";
  const isEmpty = !input.hasSendableContent && !input.allowEmptySubmit;
  const isSendButtonDisabled =
    input.disabled ||
    (!canPressLoadingButton && (input.isSubmitDisabled || input.isSubmitLoading || isEmpty));
  const defaultActionQueues = input.defaultSendBehavior === "queue" && input.isAgentRunning;
  return { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues };
}

interface ResolvedMessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  submitButtonAccessibilityLabel: string | undefined;
  submitButtonTestID: string | undefined;
  submitIcon: "arrow" | "return";
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  preserveHeightOnSubmit: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef: ((node: HTMLElement | null) => void) | undefined;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
  onPasteImages: ((files: readonly NativePastedFile[]) => void) | undefined;
  client: DaemonClient | null;
  placeholder: string | undefined;
  autoFocus: boolean;
  autoFocusKey: string | undefined;
  disabled: boolean;
  leftContent: React.ReactNode;
  rightContent: React.ReactNode;
  activeActionContent: React.ReactNode;
  isAgentRunning: boolean;
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmitLoadingPress: (() => void) | undefined;
  onKeyPressCallback: ((event: ComposerKeyPressEvent) => boolean) | undefined;
  onSelectionChangeCallback: ((selection: { start: number; end: number }) => void) | undefined;
  onFocusChange: ((focused: boolean) => void) | undefined;
  onHeightChange: ((height: number) => void) | undefined;
  inputWrapperStyle: CSSProperties | undefined;
  attachmentSlot: React.ReactNode;
  inputMode: ComposerInputMode;
  readOnly: boolean;
  textReplacement: TextReplacement;
  submitLabel: string | undefined;
}

function resolveMessageInputProps(props: MessageInputProps): ResolvedMessageInputProps {
  return {
    value: props.value,
    onChangeText: props.onChangeText,
    onSubmit: props.onSubmit,
    hasExternalContent: props.hasExternalContent ?? false,
    allowEmptySubmit: props.allowEmptySubmit ?? false,
    submitButtonAccessibilityLabel: props.submitButtonAccessibilityLabel,
    submitButtonTestID: props.submitButtonTestID,
    submitIcon: props.submitIcon ?? "arrow",
    isSubmitDisabled: props.isSubmitDisabled ?? false,
    isSubmitLoading: props.isSubmitLoading ?? false,
    preserveHeightOnSubmit: props.preserveHeightOnSubmit ?? false,
    attachments: props.attachments,
    cwd: props.cwd,
    attachmentMenuItems: props.attachmentMenuItems,
    onAttachButtonRef: props.onAttachButtonRef,
    onAddImages: props.onAddImages,
    onPasteImages: props.onPasteImages,
    client: props.client,
    placeholder: props.placeholder,
    autoFocus: props.autoFocus ?? false,
    autoFocusKey: props.autoFocusKey,
    disabled: props.disabled ?? false,
    leftContent: props.leftContent,
    rightContent: props.rightContent,
    activeActionContent: props.activeActionContent,
    isAgentRunning: props.isAgentRunning ?? false,
    defaultSendBehavior: props.defaultSendBehavior,
    onQueue: props.onQueue,
    onSubmitLoadingPress: props.onSubmitLoadingPress,
    onKeyPressCallback: props.onKeyPress,
    onSelectionChangeCallback: props.onSelectionChange,
    onFocusChange: props.onFocusChange,
    onHeightChange: props.onHeightChange,
    inputWrapperStyle: props.inputWrapperStyle,
    attachmentSlot: props.attachmentSlot,
    inputMode: props.inputMode ?? "chat",
    readOnly: props.readOnly ?? false,
    textReplacement: props.textReplacement,
    submitLabel: props.submitLabel,
  };
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  function MessageInput(props, ref) {
    const {
      value,
      onChangeText,
      onSubmit,
      hasExternalContent,
      allowEmptySubmit,
      submitButtonAccessibilityLabel,
      submitButtonTestID,
      submitIcon,
      isSubmitDisabled,
      isSubmitLoading,
      preserveHeightOnSubmit,
      attachments,
      cwd,
      attachmentMenuItems,
      onAttachButtonRef,
      onAddImages,
      onPasteImages,
      client,
      placeholder,
      autoFocus,
      autoFocusKey,
      disabled,
      leftContent,
      rightContent,
      activeActionContent,
      isAgentRunning,
      defaultSendBehavior,
      onQueue,
      onSubmitLoadingPress,
      onKeyPressCallback,
      onSelectionChangeCallback,
      onFocusChange,
      onHeightChange,
      inputWrapperStyle,
      attachmentSlot,
      inputMode,
      readOnly,
      textReplacement,
      submitLabel,
    } = resolveMessageInputProps(props);
    const mode = resolveComposerInputMode(inputMode);
    const { t } = useTranslation();
    const isCompact = useIsCompactFormFactor();
    const { height: windowHeight } = useWindowDimensions();
    const maxInputHeight = resolveMaxInputHeight(windowHeight);
    const buttonIconSize = ICON_SIZE.md;
    const toast = useToast();
    const focusInputKeys = useShortcutKeys("focus-message-input");
    const [isInputFocused, setIsInputFocused] = useState(false);
    // Web text is DOM-owned between deferred draft publications. The action button only needs
    // this boundary, so publish empty/non-empty transitions without rerendering for every key.
    const initialHasLiveText = value.trim().length > 0;
    const [hasLiveText, setHasLiveText] = useState(initialHasLiveText);
    const hasLiveTextRef = useRef(initialHasLiveText);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const textInputRef = useRef<ComposerTextInputHandle | null>(null);
    const isInputFocusedRef = useRef(false);
    const valueRef = useRef(value);
    const selectionRef = useRef({ start: value.length, end: value.length });
    const appliedTextReplacementKeyRef = useRef(textReplacement.key);
    const webTextareaRef = useRef<HTMLElement | null>(null);
    const composerHeight = useComposerHeight({
      value,
      textareaRef: webTextareaRef,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: maxInputHeight,
    });
    const { style: composerHeightStyle, scrollEnabled: isComposerScrollEnabled } = composerHeight;
    const measuredComposerHeight = composerHeight.mode === "measured" ? composerHeight : undefined;
    const updateComposerHeightForText = measuredComposerHeight?.onTextChange;
    const resetComposerHeight = measuredComposerHeight?.reset;

    // Callers keep the transcript's bottom inset in step with the composer's height.
    const onHeightChangeRef = useRef(onHeightChange);
    onHeightChangeRef.current = onHeightChange;
    useLayoutEffect(() => {
      const node = rootRef.current;
      if (!node) return;
      const observer = new ResizeObserver(([entry]) => {
        if (entry) onHeightChangeRef.current?.(entry.contentRect.height);
      });
      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    const updateLiveTextPresence = useCallback((text: string) => {
      const nextHasLiveText = text.trim().length > 0;
      if (hasLiveTextRef.current === nextHasLiveText) return;
      hasLiveTextRef.current = nextHasLiveText;
      setHasLiveText(nextHasLiveText);
    }, []);

    const replaceText = useCallback(
      (nextText: string, selection?: { start: number; end: number }) => {
        updateComposerHeightForText?.(valueRef.current, nextText);
        valueRef.current = nextText;
        updateLiveTextPresence(nextText);
        selectionRef.current = selection ?? { start: nextText.length, end: nextText.length };
        if (nextText === "") {
          textInputRef.current?.reset();
        } else {
          textInputRef.current?.replaceText(nextText, selection);
        }
        onChangeText(nextText);
      },
      [onChangeText, updateComposerHeightForText, updateLiveTextPresence],
    );

    useImperativeHandle(ref, () => ({
      focus: () => {
        textInputRef.current?.focus();
      },
      blur: () => {
        textInputRef.current?.blur();
      },
      getText: () => textInputRef.current?.getText() ?? valueRef.current,
      getInputSnapshot: () =>
        getComposerInputSnapshot(textInputRef.current, valueRef.current, selectionRef.current),
      replaceText,
      runKeyboardAction: (action) =>
        runMessageInputKeyboardAction(action, {
          focusInput: () => textInputRef.current?.focus(),
        }),
      getNativeElement: () => getTextInputNativeElement(textInputRef.current),
    }));
    useEffect(() => {
      if (appliedTextReplacementKeyRef.current === textReplacement.key) return;
      appliedTextReplacementKeyRef.current = textReplacement.key;
      updateComposerHeightForText?.(valueRef.current, textReplacement.text);
      valueRef.current = textReplacement.text;
      updateLiveTextPresence(textReplacement.text);
      if (textReplacement.text === "") {
        textInputRef.current?.reset();
      } else {
        textInputRef.current?.replaceText(textReplacement.text);
      }
    }, [textReplacement, updateComposerHeightForText, updateLiveTextPresence]);

    useEffect(() => {
      return () => {
        onFocusChange?.(false);
      };
    }, [onFocusChange]);

    const isConnected = client?.isConnected ?? false;
    const minimizeInputHeight = useCallback(() => {
      resetComposerHeight?.();
    }, [resetComposerHeight]);

    const handleSendMessage = useCallback(() => {
      const liveValue = textInputRef.current?.getText() ?? valueRef.current;
      if (!preserveHeightOnSubmit) {
        updateLiveTextPresence("");
      }
      sendMessageImpl({
        value: liveValue,
        attachments,
        hasExternalContent,
        allowEmptySubmit,
        cwd,
        isAgentRunning,
        onSubmit,
        onMinimizeHeight: minimizeInputHeight,
        preserveHeightOnSubmit,
      });
    }, [
      allowEmptySubmit,
      attachments,
      cwd,
      onSubmit,
      isAgentRunning,
      hasExternalContent,
      minimizeInputHeight,
      preserveHeightOnSubmit,
      updateLiveTextPresence,
    ]);

    const handleQueueMessage = useCallback(
      () =>
        queueMessageImpl({
          value: textInputRef.current?.getText() ?? valueRef.current,
          attachments,
          cwd,
          onQueue,
          replaceText,
          onMinimizeHeight: minimizeInputHeight,
        }),
      [attachments, cwd, onQueue, replaceText, minimizeInputHeight],
    );

    const handleDefaultSendAction = useCallback(() => {
      runDefaultSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, onQueue, handleQueueMessage, handleSendMessage]);

    const handleAlternateSendAction = useCallback(() => {
      runAlternateSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, handleSendMessage, handleQueueMessage, onQueue]);

    const getWebTextArea = useCallback(
      (): TextAreaHandle | null => getWebTextAreaImpl(textInputRef.current),
      [],
    );

    useLayoutEffect(() => {
      webTextareaRef.current = getWebTextArea() as HTMLElement | null;
    }, [getWebTextArea]);

    usePasteImagesEffect({
      getWebTextArea,
      isConnected,
      disabled,
      onAddImages,
    });

    const handleSelectionChange = useCallback(
      ({ start, end }: { start: number; end: number }) => {
        selectionRef.current = { start, end };
        onSelectionChangeCallback?.({ start, end });
      },
      [onSelectionChangeCallback],
    );

    const shouldSubmitOnEnter = !isCompact;

    const handleDesktopKeyPress = useCallback(
      (event: WebTextInputKeyPressEvent) => {
        handleDesktopKeyPressImpl(event, {
          onKeyPressCallback,
          input: getComposerInputSnapshot(
            textInputRef.current,
            valueRef.current,
            selectionRef.current,
          ),
          submitOnEnter: shouldSubmitOnEnter,
          isAgentRunning,
          onQueue,
          isSubmitDisabled,
          isSubmitLoading,
          disabled,
          handleAlternateSendAction,
          handleDefaultSendAction,
        });
      },
      [
        onKeyPressCallback,
        shouldSubmitOnEnter,
        isAgentRunning,
        onQueue,
        isSubmitDisabled,
        isSubmitLoading,
        disabled,
        handleAlternateSendAction,
        handleDefaultSendAction,
      ],
    );

    const hasSendableContent = hasSendableComposerContent({
      hasText: hasLiveText,
      attachments,
      hasExternalContent,
    });
    const primaryActionKind = resolvePrimaryActionKind({
      hasSendableContent,
      allowEmptySubmit,
      isAgentRunning,
      isSubmitLoading,
    });
    const { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues } =
      computeSendButtonState({
        disabled,
        isSubmitDisabled,
        isSubmitLoading,
        hasSendableContent,
        allowEmptySubmit,
        onSubmitLoadingPress,
        defaultSendBehavior,
        isAgentRunning,
      });
    const submitAccessibilityLabel = resolveSubmitAccessibilityLabel({
      submitButtonAccessibilityLabel,
      canPressLoadingButton,
      defaultActionQueues,
      defaultSendBehavior,
      isAgentRunning,
      t,
    });

    const sendTooltipLabel = resolveSendTooltipLabel({
      submitButtonAccessibilityLabel,
      defaultActionQueues,
      t,
    });

    const handleInputChange = useCallback(
      (nextValue: string) => {
        updateComposerHeightForText?.(valueRef.current, nextValue);
        valueRef.current = nextValue;
        updateLiveTextPresence(nextValue);
        onChangeText(nextValue);
      },
      [onChangeText, updateComposerHeightForText, updateLiveTextPresence],
    );

    const handleInputFocus = useCallback(() => {
      isInputFocusedRef.current = true;
      setIsInputFocused(true);
      onFocusChange?.(true);
    }, [onFocusChange]);

    const handleInputBlur = useCallback(() => {
      isInputFocusedRef.current = false;
      setIsInputFocused(false);
      onFocusChange?.(false);
    }, [onFocusChange]);

    const handlePasteError = useCallback(
      (message: string) => {
        console.error("[MessageInput] Native paste failed:", message);
        toast.error(t("composer.errors.pasteImageFailed"));
      },
      [t, toast],
    );

    const surfacePresentation = resolveComposerSurfacePresentation(false);

    // shadcn's input group: an input-coloured border and shadow-xs. The composer holds focus
    // nearly all the time, so focus only firms up the border; a permanent 3px ring is noise.
    const inputWrapperClassName = cn(
      "flex shrink flex-col gap-2 rounded-xl border border-input bg-background px-3 py-2 shadow-xs transition-[border-color] duration-150 ease-in-out dark:bg-input/30",
      isInputFocused && !readOnly && "border-ring",
      // Dotted says "this surface is the same box, but there is nothing to type into it"
      // without swapping the border colour, which reads as an error state.
      readOnly && "border-dotted",
    );
    const inputWrapperCombinedStyle = useMemo<CSSProperties>(
      () => ({
        ...inputWrapperStyle,
        opacity: surfacePresentation.input.opacity,
        pointerEvents: surfacePresentation.input.pointerEvents === "none" ? "none" : undefined,
      }),
      [
        inputWrapperStyle,
        surfacePresentation.input.opacity,
        surfacePresentation.input.pointerEvents,
      ],
    );
    const textInputClassName = cn(
      "block w-full shrink resize-none bg-transparent text-(length:--content-font-size) leading-[1.4] text-foreground outline-none placeholder:text-muted-foreground",
      mode.isMonospace && "font-mono",
      isComposerScrollEnabled ? "overflow-y-auto" : "overflow-y-hidden",
    );
    const sendButtonClassName = cn(
      "ml-1 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground",
      submitLabel && "w-auto min-w-7 rounded-md px-3",
      isSendButtonDisabled && "opacity-50",
    );
    const renderAttachButtonIcon = useMemo(
      () => (
        <AttachButtonIcon onAttachButtonRef={onAttachButtonRef} buttonIconSize={buttonIconSize} />
      ),
      [onAttachButtonRef, buttonIconSize],
    );

    return (
      <div ref={rootRef} className="relative shrink" data-testid="message-input-root">
        <MessageInputAutoFocus
          enabled={autoFocus}
          autoFocusKey={autoFocusKey}
          textInputRef={textInputRef}
        />
        <div className={inputWrapperClassName} style={inputWrapperCombinedStyle}>
          {attachmentSlot}
          <RenderProfile id="ComposerTextSurface">
            <ComposerTextSurface
              readOnly={readOnly}
              value={value}
              textInputRef={textInputRef}
              textInputClassName={textInputClassName}
              textInputStyle={composerHeightStyle as CSSProperties}
              placeholder={placeholder ?? t("composer.placeholders.fallback")}
              accessibilityLabel={t(mode.accessibilityLabelKey)}
              onChangeText={handleInputChange}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              editable={!disabled}
              autoFocus={false}
              onKeyPress={handleDesktopKeyPress}
              onSelectionChange={handleSelectionChange}
              onPasteImages={onPasteImages}
              onPasteError={handlePasteError}
              focusHintVisible={!isInputFocused && !value}
              focusInputKeys={focusInputKeys}
              focusHintLabel={t("composer.input.focusHint", {
                shortcut: focusInputKeys ? formatShortcut(focusInputKeys[0], getShortcutOs()) : "",
              })}
            />
          </RenderProfile>

          <div className="-mx-1.5 flex shrink-0 items-end justify-between">
            <div className="flex min-w-0 shrink grow items-end">
              <AttachmentDropdown
                visible={mode.showAttachments}
                isConnected={isConnected}
                disabled={disabled}
                renderAttachButtonIcon={renderAttachButtonIcon}
                attachmentMenuItems={attachmentMenuItems}
                addAttachmentLabel={t("composer.input.addAttachment")}
              />
              {leftContent}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {rightContent}
              <PrimaryAction
                kind={primaryActionKind}
                activeActionContent={activeActionContent}
                shouldShow
                canPressLoadingButton={canPressLoadingButton}
                onSubmitLoadingPress={onSubmitLoadingPress}
                onDefaultSendAction={handleDefaultSendAction}
                isSendButtonDisabled={isSendButtonDisabled}
                submitAccessibilityLabel={submitAccessibilityLabel}
                sendButtonClassName={sendButtonClassName}
                isSubmitLoading={isSubmitLoading}
                submitIcon={submitIcon}
                submitLabel={submitLabel}
                submitButtonTestID={submitButtonTestID}
                buttonIconSize={buttonIconSize}
                sendKeys={DEFAULT_SEND_KEYS}
                sendTooltipLabel={sendTooltipLabel}
              />
            </div>
          </div>
        </div>
      </div>
    );
  },
);
