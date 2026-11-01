"""Port packages/app's components/add-project-flow.tsx to web/src/overrides: the "Add project"
palette (choose host, method, directory search, GitHub clone and destination, new directory).
The page-stack state machine and every query and submission are the Expo file's; the RN Modal
becomes a Radix dialog (focus trap, scroll lock, Escape) laid out like the Expo overlay."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("components/add-project-flow.tsx")
p.rep('''} from "lucide-react-native";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
''', '''} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "cn";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
''')
p.rep('''import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { isWeb } from "@/constants/platform";
''', '''import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
''')
p.rep('''import {
  OverlayLayerProvider,
  useGlobalWebOverlayLayer,
  useWebOverlayRegistration,
} from "@/lib/overlay-root";
''', "")
p.rep('''import type { Theme } from "@/styles/theme";
''', "")
p.rep('''const MutedFlowIcon = withUnistyles(FlowIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

''', "")

# packages/app closed the flow from inside the state updater, which React runs during render:
# "Cannot update a component while rendering a different component" on every close (old and new).
p.rep('''  const handleBack = useCallback(() => {
    setState((current) => {
      const previous = backAddProjectPage(current);
      if (previous) return previous;
      onClose();
      return current;
    });
  }, [onClose]);''', '''  // Not from inside a setState updater: React runs those while rendering, and closing the flow
  // there updated another component mid-render ("Cannot update a component while rendering").
  const handleBack = useCallback(() => {
    const previous = backAddProjectPage(state);
    if (previous) setState(previous);
    else onClose();
  }, [onClose, state]);''')

# Back button
p.rep('''    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={styles.backButton}
      accessibilityRole="button"
      accessibilityLabel="Back"
      testID="add-project-flow-back"
    >
      {({ hovered, pressed }) => (
        <ThemedArrowLeft
          size={18}
          uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
        />
      )}
    </Pressable>''', '''    <button
      type="button"
      onClick={onPress}
      className="flex h-5 w-[18px] shrink-0 items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground"
      aria-label="Back"
      data-testid="add-project-flow-back"
    >
      <ArrowLeft size={18} />
    </button>''')

# Row. The active row is muted, not packages/app's surface1: in the light theme surface1 is the
# panel's own white, so the keyboard selection and the hover showed nothing (the combobox
# rows got the same change in step 4 batch 2).
p.rep('''function FlowRow({ option, active }: { option: FlowRowOption; active: boolean }) {
  const accessibilityState = useMemo(
    () => ({ disabled: option.disabled === true, selected: active }),
    [active, option.disabled],
  );
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (active || hovered || pressed) && styles.rowActive,
      option.disabled && styles.disabled,
    ],
    [active, option.disabled],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={option.disabled}
      onPress={option.select}
      style={rowStyle}
      testID={option.testID}
    >
      <View style={styles.iconSlot}>
        <MutedFlowIcon icon={option.icon} size={16} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {option.title}
        </Text>
        {option.subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {option.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}''', '''function FlowRow({ option, active }: { option: FlowRowOption; active: boolean }) {
  // The active row is muted, not packages/app's surface1: in the light theme surface1 is the
  // panel's own white, so neither the keyboard selection nor the hover showed.
  return (
    <button
      type="button"
      disabled={option.disabled}
      onClick={option.select}
      className={cn(
        "flex flex-row items-center gap-3 px-4 py-2 text-left enabled:hover:bg-muted enabled:active:bg-muted",
        active && "bg-muted",
        option.disabled && "opacity-50",
      )}
      aria-current={active ? "true" : undefined}
      data-testid={option.testID}
    >
      <span className="flex w-[18px] shrink-0 items-center justify-center text-muted-foreground">
        <FlowIcon icon={option.icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-[normal] text-foreground">{option.title}</span>
        {option.subtitle ? (
          <span className="mt-0.5 truncate text-xs leading-[normal] text-muted-foreground">
            {option.subtitle}
          </span>
        ) : null}
      </span>
    </button>
  );
}''')
# The title row as its own component keeps the dialog's JSX within the nesting limit.
p.rep('''function methodIcon(method: AddProjectMethodId): FlowRowOption["icon"] {''', '''function FlowTitleRow({
  title,
  hostLabel,
  onBack,
}: {
  title: string;
  hostLabel: string | null;
  onBack: (() => void) | null;
}) {
  return (
    <div className="flex min-h-5 flex-row items-center gap-2">
      {onBack ? <FlowBackButton onPress={onBack} /> : null}
      <div
        className="flex min-w-0 flex-1 flex-row items-baseline gap-2"
        data-testid="add-project-flow-title"
      >
        <DialogPrimitive.Title asChild>
          <span className="min-w-0 shrink truncate text-xs leading-[normal] font-normal text-foreground">
            {title}
          </span>
        </DialogPrimitive.Title>
        {hostLabel ? (
          <span className="min-w-0 shrink truncate text-xs leading-[normal] text-muted-foreground">
            {hostLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function methodIcon(method: AddProjectMethodId): FlowRowOption["icon"] {''')
p.rep('''    <View style={styles.footerHint}>
      <Shortcut keys={keys} textStyle={styles.footerKeyText} />
      <Text style={styles.footerAction}>{action}</Text>
    </View>''', '''    <div className="flex flex-row items-center gap-1.5">
      <Shortcut keys={keys} />
      <span className="text-xs leading-[normal] text-muted-foreground">{action}</span>
    </div>''')

# Keys: Escape through Radix (which already owns it), Enter and the arrows on the dialog.
p.rep('''  const modalLayer = useGlobalWebOverlayLayer("modal", isWeb);
  const handleWebOverlayKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!handleKey(event.key)) return false;
      event.preventDefault();
      return true;
    },
    [handleKey],
  );
  const setWebOverlayScope = useWebOverlayRegistration({
    active: isWeb,
    layer: modalLayer,
    onKeyDown: handleWebOverlayKeyDown,
  });
''', '''  // Escape goes back a page (closing on the first), so Radix's own dismiss is replaced. The other
  // keys come from the dialog, which keeps focus inside itself.
  const handleEscapeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      handleBack();
    },
    [handleBack],
  );
  const handleDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape" || event.nativeEvent.isComposing) return;
      if (handleKey(event.key)) event.preventDefault();
    },
    [handleKey],
  );
  // Focus the dialog itself rather than its first button; the page effect then focuses the input.
  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  }, []);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
''')

p.rep('''  const modal = (
    <Modal visible transparent animationType="fade" onRequestClose={isWeb ? undefined : handleBack}>
      <View style={styles.overlay} testID="add-project-flow">
        <Pressable style={styles.backdrop} onPress={onClose} testID="add-project-flow-backdrop" />
        <View
          ref={setWebOverlayScope}
          style={styles.panel}
          testID={`add-project-flow-page-${page.kind}`}
          accessibilityLabel={`Add project: ${page.kind}`}
        >
          <View style={styles.header}>
            <View style={styles.titleRow}>
              {state.pages.length > 1 ? <FlowBackButton onPress={handleBack} /> : null}
              <View style={styles.titleGroup} testID="add-project-flow-title">
                <Text style={styles.title} numberOfLines={1}>
                  {pageTitle(page)}
                </Text>
                {host ? (
                  <Text style={styles.hostContext} numberOfLines={1}>
                    {host.label}
                  </Text>
                ) : null}
              </View>
            </View>
            {page.kind !== "method" ? (
              <ThemedTextInput
                ref={inputRef}
                initialValue={pageInput(page)}
                onChangeText={handleInputChange}
                placeholder={pagePlaceholder(page)}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSubmitting}
                returnKeyType="go"
                testID="add-project-flow-input"
              />
            ) : null}
          </View>
          <ScrollView
            style={styles.results}
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            testID="add-project-flow-results"
          >
            {preview ? (
              <Text style={styles.preview} testID="add-project-flow-path-preview">
                {shortenPath(preview)}
              </Text>
            ) : null}
            {isSubmitting ? (
              <Text style={styles.stateText} testID="add-project-flow-progress">
                {progressText(page)}
              </Text>
            ) : null}
            {!isSubmitting && page.error ? (
              <Text style={styles.errorText} testID="add-project-flow-error">
                {page.error}
              </Text>
            ) : null}
            {!isSubmitting && queryError ? (
              <Text style={styles.errorText} testID="add-project-flow-query-error">
                {queryError}
              </Text>
            ) : null}
            {!isSubmitting && loading ? (
              <Text style={styles.stateText} testID="add-project-flow-loading">
                Loading...
              </Text>
            ) : null}''', '''  return (
    <DialogPrimitive.Root open onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        {/* The dialog is the whole overlay, as packages/app's Modal: the backdrop is a sibling of
            the panel inside it, and a click on it closes the flow. */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={handleEscapeKeyDown}
          onOpenAutoFocus={handleOpenAutoFocus}
          onKeyDown={handleDialogKeyDown}
          className="fixed inset-0 z-50 flex flex-col items-center justify-start pt-12 outline-none"
          data-testid="add-project-flow"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
            data-testid="add-project-flow-backdrop"
          />
          <div
            className="relative flex max-h-[80%] w-[640px] max-w-[92%] flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
            data-testid={`add-project-flow-page-${page.kind}`}
            aria-label={`Add project: ${page.kind}`}
          >
            <div className="flex shrink-0 flex-col gap-2 border-b px-4 pt-2 pb-3">
              <FlowTitleRow
                title={pageTitle(page)}
                hostLabel={host?.label ?? null}
                onBack={state.pages.length > 1 ? handleBack : null}
              />
              {page.kind !== "method" ? (
                <TextInput
                  ref={inputRef}
                  initialValue={pageInput(page)}
                  onChangeText={handleInputChange}
                  placeholder={pagePlaceholder(page)}
                  className="py-1 text-sm leading-[normal] text-foreground outline-none placeholder:text-muted-foreground"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  enterKeyHint="go"
                  testID="add-project-flow-input"
                />
              ) : null}
            </div>
            <div
              className="min-h-0 shrink grow-0 overflow-y-auto [scrollbar-width:none]"
              data-testid="add-project-flow-results"
            >
              <div className="flex flex-col py-2">
                {preview ? (
                  <span
                    className="px-4 py-2 text-sm leading-[normal] text-muted-foreground"
                    data-testid="add-project-flow-path-preview"
                  >
                    {shortenPath(preview)}
                  </span>
                ) : null}
                {isSubmitting ? (
                  <span
                    className="p-4 text-sm leading-[normal] text-muted-foreground"
                    data-testid="add-project-flow-progress"
                  >
                    {progressText(page)}
                  </span>
                ) : null}
                {!isSubmitting && page.error ? (
                  <span
                    className="px-4 py-3 text-xs leading-[normal] text-destructive"
                    data-testid="add-project-flow-error"
                  >
                    {page.error}
                  </span>
                ) : null}
                {!isSubmitting && queryError ? (
                  <span
                    className="px-4 py-3 text-xs leading-[normal] text-destructive"
                    data-testid="add-project-flow-query-error"
                  >
                    {queryError}
                  </span>
                ) : null}
                {!isSubmitting && loading ? (
                  <span
                    className="p-4 text-sm leading-[normal] text-muted-foreground"
                    data-testid="add-project-flow-loading"
                  >
                    Loading...
                  </span>
                ) : null}''')
p.rep('''            page.kind !== "new-directory-name" ? (
              <Text style={styles.stateText} testID="add-project-flow-empty">
                {emptyText(page, host ?? null)}
              </Text>
            ) : null}
          </ScrollView>
          <View style={styles.footer} testID="add-project-flow-footer">
            <FlowHint keys={NAVIGATION_HINT_KEYS} action="Navigate" />
            <FlowHint keys={SELECT_HINT_KEYS} action="Select" />
            <FlowHint keys={ESCAPE_HINT_KEYS} action={state.pages.length > 1 ? "Back" : "Close"} />
          </View>
        </View>
      </View>
    </Modal>
  );

  return createElement(OverlayLayerProvider, { layer: isWeb ? modalLayer : 0 }, modal);
}''', '''            page.kind !== "new-directory-name" ? (
              <span
                className="p-4 text-sm leading-[normal] text-muted-foreground"
                data-testid="add-project-flow-empty"
              >
                {emptyText(page, host ?? null)}
              </span>
            ) : null}
              </div>
            </div>
            <div
              className="flex shrink-0 flex-row flex-wrap items-center gap-4 border-t px-4 py-2"
              data-testid="add-project-flow-footer"
            >
              <FlowHint keys={NAVIGATION_HINT_KEYS} action="Navigate" />
              <FlowHint keys={SELECT_HINT_KEYS} action="Select" />
              <FlowHint
                keys={ESCAPE_HINT_KEYS}
                action={state.pages.length > 1 ? "Back" : "Close"}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the Add project palette; a Radix dialog laid out like the Expo overlay, DOM view.",
        "add-project-flow.py")
