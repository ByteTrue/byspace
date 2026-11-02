#!/usr/bin/env python3
"""Port packages/app's terminal panel and pane to web/src/overrides: same logic, DOM view."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "packages/app/src"
OVR = ROOT / "web/src/overrides"


def make_rep(state):
    def rep(old, new, count=1):
        n = state["s"].count(old)
        if n != count:
            raise SystemExit(f"{state['name']}: expected {count} of:\n{old[:300]}\n--- found {n}")
        state["s"] = state["s"].replace(old, new)

    return rep


def check_leftovers(state, needles):
    for needle in needles:
        if needle in state["s"]:
            i = state["s"].index(needle)
            raise SystemExit(f"{state['name']}: leftover {needle}: {state['s'][i - 300:i + 200]}")


# ---------------------------------------------------------------- terminal-panel.tsx
panel = {"name": "terminal-panel", "s": (APP / "panels/terminal-panel.tsx").read_text(encoding="utf-8")}
rep = make_rep(panel)
rep('import { Terminal } from "lucide-react-native";\nimport { Text, View } from "react-native";\n',
    'import { Terminal } from "lucide-react";\n')
rep('''const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

''', "")
rep('''      <View style={CENTERED_PADDED_STYLE}>
        <Text>Workspace directory not found.</Text>
      </View>''', '''      <div className="flex flex-1 items-center justify-center p-4">
        <span>Workspace directory not found.</span>
      </div>''')
check_leftovers(panel, ["<View", "<Text", "react-native"])
(OVR / "panels/terminal-panel.tsx").write_text(
    """// Override of packages/app/src/panels/terminal-panel.tsx: same descriptor and pane, DOM view.
// Generated from the Expo file by web/scripts/port/terminal-pane.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
""" + panel["s"], encoding="utf-8")

# ---------------------------------------------------------------- terminal-pane.tsx
pane = {"name": "terminal-pane", "s": (APP / "components/terminal-pane.tsx").read_text(encoding="utf-8")}
rep = make_rep(pane)

# imports
rep('''import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import Animated, { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Keyboard as KeyboardIcon, KeyboardOff as KeyboardOffIcon } from "lucide-react-native";''',
    '''import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as Clipboard from "expo-clipboard";
import { useUnistyles } from "react-native-unistyles";
import { Keyboard as KeyboardIcon, KeyboardOff as KeyboardOffIcon } from "lucide-react";''')
rep('import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";\n', "")
# Relative imports would bypass the web overrides; go through `@/`.
rep('} from "./terminal-pane-focus-claim";', '} from "@/components/terminal-pane-focus-claim";')
rep('import TerminalEmulator, { type TerminalEmulatorHandle } from "./terminal-emulator";',
    'import TerminalEmulator, { type TerminalEmulatorHandle } from "@/components/terminal-emulator";')
rep('import { TerminalFloatingCopyAction, TerminalPasteAction } from "./terminal-copy-paste-actions";',
    'import {\n  TerminalFloatingCopyAction,\n  TerminalPasteAction,\n} from "@/components/terminal-copy-paste-actions";')
rep('import { LoadingSpinner } from "@/components/ui/loading-spinner";\n', "")
if 'from "./' in pane["s"]:
    raise SystemExit("terminal-pane: relative import left")

# the key buttons: the terminal's palette goes in as CSS variables, hover and press read them
KEY_BUTTON = (
    '"flex h-[34px] min-w-0 flex-1 items-center justify-center rounded-md border px-1 text-sm font-medium '
    'border-(--key-border) bg-(--key-surface) text-(--key-text) hover:bg-(--key-surface-hovered) '
    'active:bg-(--key-surface-hovered)"'
)
rep('''function ModifierButton({ modifier, active, palette, onToggle }: ModifierButtonProps) {
  const handlePress = useCallback(() => onToggle(modifier), [onToggle, modifier]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.keyButton,
      { backgroundColor: palette.surface, borderColor: palette.border },
      active && { borderColor: palette.activeBorder, backgroundColor: palette.surfaceHovered },
      (Boolean(hovered) || pressed) && { backgroundColor: palette.surfaceHovered },
    ],
    [active, palette],
  );
  const textStyle = useMemo(
    () => [styles.keyButtonText, { color: palette.text }, active && { color: palette.textActive }],
    [active, palette],
  );
  return (
    <Pressable testID={`terminal-key-${modifier}`} onPress={handlePress} style={pressableStyle}>
      <Text style={textStyle}>{MODIFIER_LABELS[modifier]}</Text>
    </Pressable>
  );
}''', '''function ModifierButton({ modifier, active, palette, onToggle }: ModifierButtonProps) {
  const handlePress = useCallback(() => onToggle(modifier), [onToggle, modifier]);
  const style = useMemo(() => keyPaletteStyle(palette, active), [active, palette]);
  return (
    <button
      type="button"
      data-testid={`terminal-key-${modifier}`}
      aria-pressed={active}
      onClick={handlePress}
      style={style}
      className={KEY_BUTTON_CLASS_NAME}
    >
      {MODIFIER_LABELS[modifier]}
    </button>
  );
}''')
rep('''function VirtualKeyButton({ id, label, keyValue, palette, onSend }: VirtualKeyButtonProps) {
  const handlePress = useCallback(() => onSend(keyValue), [onSend, keyValue]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.keyButton,
      { backgroundColor: palette.surface, borderColor: palette.border },
      (Boolean(hovered) || pressed) && { backgroundColor: palette.surfaceHovered },
    ],
    [palette],
  );
  const textStyle = useMemo(() => [styles.keyButtonText, { color: palette.text }], [palette]);
  return (
    <Pressable testID={`terminal-key-${id}`} onPress={handlePress} style={pressableStyle}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}''', '''function VirtualKeyButton({ id, label, keyValue, palette, onSend }: VirtualKeyButtonProps) {
  const handlePress = useCallback(() => onSend(keyValue), [onSend, keyValue]);
  const style = useMemo(() => keyPaletteStyle(palette, false), [palette]);
  return (
    <button
      type="button"
      data-testid={`terminal-key-${id}`}
      onClick={handlePress}
      style={style}
      className={KEY_BUTTON_CLASS_NAME}
    >
      {label}
    </button>
  );
}''')
rep('''  const label = isKeyboardVisible ? "Hide keyboard" : "Show keyboard";
  const Icon = isKeyboardVisible ? KeyboardOffIcon : KeyboardIcon;
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.keyButton,
      { backgroundColor: palette.surface, borderColor: palette.border },
      (Boolean(hovered) || pressed) && { backgroundColor: palette.surfaceHovered },
    ],
    [palette],
  );

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      testID="terminal-keyboard-toggle"
      onPress={onToggle}
      style={pressableStyle}
    >
      <Icon color={iconColor} size={16} />
    </Pressable>
  );''', '''  const label = isKeyboardVisible ? "Hide keyboard" : "Show keyboard";
  const Icon = isKeyboardVisible ? KeyboardOffIcon : KeyboardIcon;
  const style = useMemo(() => keyPaletteStyle(palette, false), [palette]);
  return (
    <button
      type="button"
      aria-label={label}
      data-testid="terminal-keyboard-toggle"
      onClick={onToggle}
      style={style}
      className={KEY_BUTTON_CLASS_NAME}
    >
      <Icon color={iconColor} size={16} />
    </button>
  );''')
rep('''interface ModifierButtonProps {''', f'''const KEY_BUTTON_CLASS_NAME =
  {KEY_BUTTON};

/** The key's colors as CSS variables, so hover and press can read them. */
function keyPaletteStyle(palette: TerminalKeyPalette, active: boolean): CSSProperties {{
  return {{
    "--key-border": active ? palette.activeBorder : palette.border,
    "--key-surface": active ? palette.surfaceHovered : palette.surface,
    "--key-surface-hovered": palette.surfaceHovered,
    "--key-text": active ? palette.textActive : palette.text,
  }} as CSSProperties;
}}

interface ModifierButtonProps {{''')

# keyboard: react-native-keyboard-controller reports no keyboard on the web, so the Expo web app
# never shifted or reflowed for it; the browser resizes the page for the on-screen keyboard.
rep('''  const { shift: keyboardShift, style: keyboardPaddingStyle } = useKeyboardShiftStyle({
    mode: "padding",
    enabled: isMobile,
  });
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
''', '''  // react-native-keyboard-controller reports no keyboard on the web, so the Expo web app never
  // shifted or reflowed for one: the browser resizes the page for the on-screen keyboard.
  const keyboardInset = 0;
  const isKeyboardVisible = false;
''')
start = pane["s"].index("  const clearKeyboardRefitTimeouts = useCallback(() => {")
end = pane["s"].index("  useEffect(() => {\n    if (!client || !isConnected || !isWorkspaceFocused) {", start)
pane["s"] = pane["s"][:start] + pane["s"][end:]
rep('''  const keyboardRefitTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
''', "")
rep('''  const TERMINAL_REFIT_DELAYS_MS = [0, 48, 144, 320];
''', "", count=0) if False else None
pane["s"] = pane["s"].replace("const TERMINAL_REFIT_DELAYS_MS = [0, 48, 144, 320];\n", "", 1)

# view
rep('''  const containerStyle = useMemo(
    () => [
      styles.container,
      keyboardPaddingStyle,
      { backgroundColor: terminalTheme.colors.surface0 },
    ],
    [keyboardPaddingStyle, terminalTheme],
  );''', '''  const containerStyle = useMemo<CSSProperties>(
    () => ({ backgroundColor: terminalTheme.colors.surface0 }),
    [terminalTheme],
  );
  const outputStyle = useMemo<CSSProperties>(
    () => ({ backgroundColor: terminalTheme.colors.background }),
    [terminalTheme],
  );
  const errorRowStyle = useMemo<CSSProperties>(
    () => ({
      borderTopColor: terminalTheme.colors.border,
      backgroundColor: terminalTheme.colors.surface1,
    }),
    [terminalTheme],
  );
  const mutedTextStyle = useMemo<CSSProperties>(
    () => ({ color: terminalTheme.colors.foregroundMuted }),
    [terminalTheme],
  );
  const errorTextStyle = useMemo<CSSProperties>(
    () => ({ color: terminalTheme.colors.destructive }),
    [terminalTheme],
  );
  const keyboardStyle = useMemo<CSSProperties>(
    () => ({
      borderTopColor: terminalTheme.colors.border,
      backgroundColor: terminalTheme.colors.surface0,
    }),
    [terminalTheme],
  );''')
rep('''      <View style={styles.centerState}>
        <Text style={[styles.stateText, { color: terminalTheme.colors.foregroundMuted }]}>
          {t("workspace.terminal.hostDisconnected")}
        </Text>
      </View>''', '''      <div className="flex flex-1 items-center justify-center px-4">
        <span className="text-center text-sm" style={mutedTextStyle}>
          {t("workspace.terminal.hostDisconnected")}
        </span>
      </div>''')
rep('''    <Animated.View style={containerStyle}>
      <View style={[styles.outputContainer, { backgroundColor: terminalTheme.colors.background }]}>
        <View style={styles.terminalGestureContainer}>''', '''    <div className="flex min-h-0 flex-1 flex-col" style={containerStyle}>
      <div className="relative flex min-h-0 flex-1 flex-col" style={outputStyle}>
        <div className="flex min-h-0 flex-1 flex-col">''')
rep('''            resizeRequestToken={resizeRequestToken}
          />
        </View>''', '''            resizeRequestToken={resizeRequestToken}
          />
        </div>''')
rep('''          <View style={styles.attachOverlay} pointerEvents="none" testID="terminal-attach-loading">
            <LoadingSpinner size="small" color={terminalTheme.colors.foregroundMuted} />
          </View>''', '''          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/16"
            data-testid="terminal-attach-loading"
          >
            <Spinner className="size-4" style={mutedTextStyle} />
          </div>''')
rep('''          <View pointerEvents="box-none" style={styles.floatingCopyContainer}>
            <TerminalFloatingCopyAction hasSelection={hasSelection} onCopy={handleTerminalCopy} />
          </View>
        ) : null}
      </View>''', '''          <div className="absolute right-3 bottom-12 z-2">
            <TerminalFloatingCopyAction hasSelection={hasSelection} onCopy={handleTerminalCopy} />
          </div>
        ) : null}
      </div>''')
rep('''        <View
          style={[
            styles.errorRow,
            {
              borderTopColor: terminalTheme.colors.border,
              backgroundColor: terminalTheme.colors.surface1,
            },
          ]}
        >
          <Text
            style={[styles.statusError, { color: terminalTheme.colors.destructive }]}
            numberOfLines={2}
          >
            {streamError}
          </Text>
        </View>''', '''        <div className="border-t px-3 py-1" style={errorRowStyle}>
          <span className="line-clamp-2 text-xs" style={errorTextStyle}>
            {streamError}
          </span>
        </div>''')
rep('''        <View
          style={[
            styles.keyboardContainer,
            {
              borderTopColor: terminalTheme.colors.border,
              backgroundColor: terminalTheme.colors.surface0,
            },
          ]}
          testID="terminal-virtual-keyboard"
        >
          <View style={styles.keyboardRows}>
            {TERMINAL_VIRTUAL_KEYBOARD_ROWS.map((row) => (
              <View
                key={row.map(getTerminalVirtualKeyboardControlId).join(":")}
                style={styles.keyboardRow}
              >
                {row.map(renderVirtualKeyboardControl)}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Animated.View>''', '''        <div className="border-t p-2" style={keyboardStyle} data-testid="terminal-virtual-keyboard">
          <div className="flex flex-col gap-1">
            {TERMINAL_VIRTUAL_KEYBOARD_ROWS.map((row) => (
              <div
                key={row.map(getTerminalVirtualKeyboardControlId).join(":")}
                className="flex items-center gap-1"
              >
                {row.map(renderVirtualKeyboardControl)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>''')
rep('''            dom={TERMINAL_EMULATOR_DOM_PROPS}
''', "")
start = pane["s"].index("const styles = StyleSheet.create((theme) => ({")
pane["s"] = pane["s"][:start].rstrip() + "\n"
pane["s"] = pane["s"].replace(
    'import { useTranslation } from "react-i18next";',
    'import { useTranslation } from "react-i18next";\nimport { Spinner } from "~/components/ui/spinner";',
    1,
)
check_leftovers(pane, ["<View", "<Text", "<Pressable", "Animated", "styles.", "StyleSheet",
                       "keyboardShift", "keyboardPaddingStyle", "PressableStateCallbackType"])
(OVR / "components/terminal-pane.tsx").write_text(
    """// Override of packages/app/src/components/terminal-pane.tsx. The terminal logic is the Expo file's
// (stream attach and replay, size claims, focus, keys and modifiers, paste, copy, local file links,
// the phone's key rows); the view is DOM and Tailwind.
// Generated from the Expo file by web/scripts/port/terminal-pane.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
""" + pane["s"], encoding="utf-8")
print("ok")
