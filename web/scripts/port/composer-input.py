#!/usr/bin/env python3
"""Port packages/app's composer/input/input.tsx to web/src/overrides: same logic, DOM view."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/composer/input/input.tsx")
DST = str(ROOT / "web/src/overrides/composer/input/input.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:300]}\n--- found {n}")
    s = s.replace(old, new)


def replace_between(start_marker, end_marker, new):
    global s
    start = s.index(start_marker)
    end = s.index(end_marker, start)
    s = s[:start] + new + s[end:]


# ---- imports ----
rep('import { LoadingSpinner } from "@/components/ui/loading-spinner";\n', "")
rep('''import {
  View,
  Text,
  useWindowDimensions,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
  type LayoutChangeEvent,
} from "react-native";''', '''import { useWindowDimensions } from "react-native";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";''')
rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n', "")
rep('import { ICON_SIZE, type Theme } from "@/styles/theme";', 'import { ICON_SIZE } from "@/styles/theme";')
rep('import { ArrowUp, CornerDownLeft, Plus } from "lucide-react-native";',
    'import { ArrowUp, CornerDownLeft, Plus } from "lucide-react";\nimport { cn } from "cn";\nimport { Spinner } from "~/components/ui/spinner";')
rep('import { useComposerHeight } from "./height";', 'import { useComposerHeight } from "@/composer/input/height";')
rep('''import {
  EditingTextInput,
  type EditingTextInputHandle as ComposerTextInputHandle,
  type EditingTextInputProps,
} from "@/components/ui/text-input";

// Placeholders sit at foregroundMuted, as everywhere else (docs/design.md).
const ComposerTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
import { resolveSendTooltipLabel, resolveSubmitAccessibilityLabel } from "./labels";''', '''import {
  EditingTextInput,
  type EditingTextInputHandle as ComposerTextInputHandle,
} from "@/components/ui/text-input";
import { resolveSendTooltipLabel, resolveSubmitAccessibilityLabel } from "@/composer/input/labels";''')
rep('} from "./state";', '} from "@/composer/input/state";')
rep('const COMPOSER_INPUT_DATASET = { composerInput: "" } as const;\n', "")

# ---- prop types that named React Native views ----
rep("  onAttachButtonRef?: (node: View | null) => void;", "  onAttachButtonRef?: (node: HTMLElement | null) => void;")
rep('''  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;''', '''  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: CSSProperties;''')
rep("  onAttachButtonRef: ((node: View | null) => void) | undefined;",
    "  onAttachButtonRef: ((node: HTMLElement | null) => void) | undefined;", count=2)
rep('  inputWrapperStyle: import("react-native").ViewStyle | undefined;', "  inputWrapperStyle: CSSProperties | undefined;")
rep('''type WebTextInputKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    // Web-only: present on DOM KeyboardEvent during IME composition (CJK input).
    isComposing?: boolean;
    keyCode?: number;
  }
>;''', '''type WebTextInputKeyPressEvent = ReactKeyboardEvent<HTMLInputElement & HTMLTextAreaElement>;''')

# ---- small view components ----
replace_between("function AttachButtonIcon({", "interface DesktopKeyPressContext {", '''function AttachButtonIcon({
  hovered,
  onAttachButtonRef,
  buttonIconSize,
}: {
  hovered: boolean;
  onAttachButtonRef: ((node: HTMLElement | null) => void) | undefined;
  buttonIconSize: number;
}) {
  return (
    <span ref={onAttachButtonRef} className="flex size-7 items-center justify-center">
      <Plus size={buttonIconSize} className={hovered ? "text-foreground" : "text-muted-foreground"} />
    </span>
  );
}

function AttachmentMenuList({ items }: { items: AttachmentMenuItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          testID={`message-input-attachment-menu-item-${item.id}`}
          disabled={item.disabled}
          onSelect={item.onSelect}
          leading={item.icon ?? null}
        >
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
  renderAttachButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  attachmentMenuItems: AttachmentMenuItem[];
  addAttachmentLabel: string;
}) {
  const isButtonDisabled = !isConnected || disabled;
  if (!visible) return null;
  return (
    <DropdownMenu compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={isButtonDisabled}
            accessibilityLabel={addAttachmentLabel}
            testID="message-input-attach-button"
            className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
          >
            {renderAttachButtonIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          {addAttachmentLabel}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        minWidth={220}
        testID="message-input-attachment-menu"
        sheetTitle={addAttachmentLabel}
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

''')

replace_between("function FocusHint({", "function SendButtonTooltip({", '''function FocusHint({
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
        <p className={cn(props.textInputClassName, "text-muted-foreground")} style={READ_ONLY_STYLE} data-testid="composer-readonly-content">
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
      <FocusHint visible={props.focusHintVisible} focusInputKeys={props.focusInputKeys} label={props.focusHintLabel} />
    </div>
  );
}

''')

replace_between("function SendButtonTooltip({", "type PrimaryActionKind =", '''function SendButtonTooltip({
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
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
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
      <TooltipContent side="top" align="center" offset={8}>
        <SendTooltipBody label={sendTooltipLabel} sendKeys={sendKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

''')

# ---- MessageInput body ----
rep('''    const buttonIconSize = isWeb ? ICON_SIZE.md : ICON_SIZE.lg;''', '''    const buttonIconSize = ICON_SIZE.md;''')
rep('''    const rootRef = useRef<View | null>(null);
    const inputWrapperRef = useRef<View | null>(null);''', '''    const rootRef = useRef<HTMLDivElement | null>(null);''')
rep('''    const handleComposerLayout = useCallback(
      (event: LayoutChangeEvent) => onHeightChange?.(event.nativeEvent.layout.height),
      [onHeightChange],
    );''', '''    // Callers keep the transcript's bottom inset in step with the composer's height.
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
    }, []);''')
rep('''    const handleSelectionChange = useCallback(
      (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        const start = event.nativeEvent.selection?.start ?? 0;
        const end = event.nativeEvent.selection?.end ?? start;
        selectionRef.current = { start, end };
        onSelectionChangeCallback?.({ start, end });
      },
      [onSelectionChangeCallback],
    );''', '''    const handleSelectionChange = useCallback(
      ({ start, end }: { start: number; end: number }) => {
        selectionRef.current = { start, end };
        onSelectionChangeCallback?.({ start, end });
      },
      [onSelectionChangeCallback],
    );''')
rep('''    const attachButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) => [
        styles.attachButton,
        Boolean(hovered) && styles.iconButtonHovered,
        (!isConnected || disabled) && styles.buttonDisabled,
      ],
      [isConnected, disabled],
    );

''', "")
start = s.index("    const inputWrapperCombinedStyle = useMemo(")
end = s.index("    const renderAttachButtonIcon = useCallback(")
s = s[:start] + '''    // shadcn's input group: an input-coloured border and shadow-xs. The composer holds focus
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
      [inputWrapperStyle, surfacePresentation.input.opacity, surfacePresentation.input.pointerEvents],
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
''' + s[end:]
s = s.replace('''      [onAttachButtonRef, buttonIconSize],
    );
''', '''      [onAttachButtonRef, buttonIconSize],
    );
''', 1)

start = s.index("    return (\n      <View\n        ref={rootRef}")
end = s.index("const styles = StyleSheet.create(")
s = s[:start] + '''    return (
      <div ref={rootRef} className="relative shrink" data-testid="message-input-root">
        <MessageInputAutoFocus enabled={autoFocus} autoFocusKey={autoFocusKey} textInputRef={textInputRef} />
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
              onKeyPress={shouldHandleWebKeyPress ? handleDesktopKeyPress : undefined}
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
'''
# The read-only text grows with its own content instead of the measured input height.
s = s.replace("const MIN_INPUT_HEIGHT = isWeb ? MIN_INPUT_HEIGHT_DESKTOP : MIN_INPUT_HEIGHT_MOBILE;",
              "const MIN_INPUT_HEIGHT = isWeb ? MIN_INPUT_HEIGHT_DESKTOP : MIN_INPUT_HEIGHT_MOBILE;\nconst READ_ONLY_STYLE: CSSProperties = { minHeight: MIN_INPUT_HEIGHT };", 1)

for needle in ["<View", "<Text", "styles.", "StyleSheet", "Themed", "uniProps", "LayoutChangeEvent",
               "NativeSyntheticEvent", "withUnistyles"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-300:i+200]}")
s = """// Override of packages/app/src/composer/input/input.tsx. The input logic is the Expo file's (send,
// queue, steer, IME, paste, height, keyboard actions); the view is DOM and Tailwind.
// Generated from the Expo file by web/scripts/port/composer-input.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
""" + s
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
