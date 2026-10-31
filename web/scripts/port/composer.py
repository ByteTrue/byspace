#!/usr/bin/env python3
"""Port packages/app's composer/index.tsx to web/src/overrides: same logic, DOM view."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/composer/index.tsx")
DST = str(ROOT / "web/src/overrides/composer/index.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:300]}\n--- found {n}")
    s = s.replace(old, new)


# ---- imports ----
rep('import { View, Pressable, Text, StyleSheet as RNStyleSheet } from "react-native";\n', "")
rep('''  type ReactElement,
  type ReactNode,
} from "react";''', '''  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "cn";''')
rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";',
    'import { withUnistyles } from "react-native-unistyles";')
# Relative imports would bypass the web overrides; go through `@/`.
s = re.sub(r'from "\./([^"]+)"', r'from "@/composer/\1"', s)

# ---- prop types that named React Native styles ----
rep('''  inputWrapperStyle?: import("react-native").ViewStyle;''', '''  inputWrapperStyle?: CSSProperties;''')

# ---- small view helpers ----
rep('''function buildCancelButtonStyle(isConnected: boolean, isCancellingAgent: boolean): object[] {
  const disabled = !isConnected || isCancellingAgent ? styles.buttonDisabled : undefined;
  return [styles.cancelButton, disabled].filter((value): value is object => Boolean(value));
}''', '''function buildCancelButtonStyle(isConnected: boolean, isCancellingAgent: boolean): string {
  return cn(
    "ml-1 flex size-7 items-center justify-center rounded-md bg-red-600",
    (!isConnected || isCancellingAgent) && "opacity-50",
  );
}''')
rep("  cancelButtonStyle: (object | undefined)[];", "  cancelButtonStyle: string;")
rep('''        accessibilityRole="button"
        style={cancelButtonStyle}''', '''        className={cancelButtonStyle}''')
s = s.replace("buildCancelButtonStyle", "buildCancelButtonClassName").replace("cancelButtonStyle", "cancelButtonClassName")
rep('''        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{t("composer.cancel.interrupt")}</Text>
          {shortcutNode}
        </View>''', '''        <span className="flex items-center gap-2">
          <span>{t("composer.cancel.interrupt")}</span>
          {shortcutNode}
        </span>''')
rep('''  return reserveSlot ? <View style={styles.contextWindowMeterSlot}>{meter}</View> : null;''',
    '''  return reserveSlot ? (
    <span className="flex size-7 shrink-0 items-center justify-center">{meter}</span>
  ) : null;''')
rep('''    <View style={styles.attachmentTray} testID="composer-attachment-tray">''',
    '''    <div className="flex flex-wrap gap-2" data-testid="composer-attachment-tray">''')
rep('''    <View style={styles.queueTrack}>''', '''    <div className="flex flex-col gap-2">''')
rep('''    <View style={styles.queueItem}>
      <Text style={styles.queueText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={styles.queueActions}>
        <Pressable
          onPress={handleEdit}
          style={styles.queueActionButton}
          accessibilityLabel={editLabel}
          accessibilityRole="button"
        >
          <ThemedPencil size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
        </Pressable>
        <Pressable
          onPress={handleSendNow}
          style={[styles.queueActionButton, styles.queueSendButton]}
          accessibilityLabel={sendNowLabel}
          accessibilityRole="button"
        >
          <ThemedArrowUp size={ICON_SIZE.sm} uniProps={iconAccentForegroundMapping} />
        </Pressable>
      </View>
    </View>''', '''    <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2">
      <span className="line-clamp-2 min-w-0 flex-1 text-sm text-foreground">{item.text}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleEdit}
          aria-label={editLabel}
          className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground hover:bg-accent"
        >
          <Pencil size={ICON_SIZE.sm} />
        </button>
        <button
          type="button"
          onClick={handleSendNow}
          aria-label={sendNowLabel}
          className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <ArrowUp size={ICON_SIZE.sm} />
        </button>
      </div>
    </div>''')
rep('''        return <View key={option.id} />;''', '''        return <div key={option.id} />;''')

# ---- refs that held React Native views ----
rep("  const attachButtonRef = useRef<View | null>(null);", "  const attachButtonRef = useRef<HTMLElement | null>(null);")
rep("  const handleAttachButtonRef = useCallback((node: View | null) => {",
    "  const handleAttachButtonRef = useCallback((node: HTMLElement | null) => {")
rep("  const messageInputContainerRef = useRef<View>(null);",
    "  const messageInputContainerRef = useRef<HTMLDivElement | null>(null);")

# ---- the input area ----
rep('''  const inputAreaContainerStyle = useMemo(
    () => [styles.inputAreaContainer, isComposerLocked && styles.inputAreaLocked],
    [isComposerLocked],
  );''', '''  const inputAreaContainerClassName = cn(
    "relative mx-auto flex w-full shrink flex-col items-center overflow-visible px-4 pb-4",
    isComposerLocked && "opacity-60",
  );''')
rep('''        <Text accessibilityRole="alert" style={styles.sendErrorText}>
          {sendError}
        </Text>''', '''        <span role="alert" className="text-sm text-red-500">
          {sendError}
        </span>''')
rep('''      <KeyboardTranslateView
        style={animatedStaticStyles.container}
        enabled={!externalKeyboardShift}
      >''', '''      <KeyboardTranslateView
        className="relative flex shrink flex-col"
        enabled={!externalKeyboardShift}
      >''')
rep('''        <View style={inputAreaContainerStyle}>
          <View style={styles.inputAreaContent}>''', '''        <div className={inputAreaContainerClassName} style={INPUT_AREA_STYLE}>
          <div className="flex w-full shrink flex-col gap-3" style={INPUT_AREA_CONTENT_STYLE}>''')
rep('''            <View ref={messageInputContainerRef} style={styles.messageInputContainer}>''',
    '''            <div ref={messageInputContainerRef} className="relative flex w-full shrink flex-col gap-3">''')
s = s.replace("</View>", "</div>")

# ---- drop the style objects, keep the icon mappings below them ----
start = s.index("const animatedStaticStyles = RNStyleSheet.create({")
end_marker = "})) as unknown as Record<string, object>;\n"
end = s.index(end_marker, start) + len(end_marker)
s = s[:start] + '''const INPUT_AREA_STYLE: CSSProperties = { minHeight: FOOTER_HEIGHT };
const INPUT_AREA_CONTENT_STYLE: CSSProperties = { maxWidth: MAX_CONTENT_WIDTH };
''' + s[end:]
# Queue rows draw these icons directly now.
for unused in ["const ThemedPencil = withUnistyles(Pencil);\n", "const ThemedArrowUp = withUnistyles(ArrowUp);\n",
               "const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });\n",
               "const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });\n"]:
    rep(unused, "")

for needle in ["<View", "<Text", "<Pressable", "styles.", "StyleSheet", "animatedStaticStyles"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-300:i+200]}")
s = """// Override of packages/app/src/composer/index.tsx. The composer logic is the Expo file's (drafts,
// attachments, forge links, slash commands, autocomplete, queue, send/steer/interrupt, keyboard
// actions); the view is DOM and Tailwind.
// Generated from the Expo file by web/scripts/port/composer.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
""" + s
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
