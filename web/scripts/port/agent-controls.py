#!/usr/bin/env python3
"""Port packages/app's composer/agent-controls/index.tsx to web/src/overrides: same logic, DOM view."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/composer/agent-controls/index.tsx")
DST = str(ROOT / "web/src/overrides/composer/agent-controls/index.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:300]}\n--- found {n}")
    s = s.replace(old, new)


# ---- imports ----
rep('''import {
  View,
  Text,
  Pressable,
  Keyboard,
  useWindowDimensions,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";''', '''import { Keyboard, useWindowDimensions } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { cn } from "cn";''')
rep('import { readMeasuredWidth } from "@/hooks/use-container-width";\n', "")
if "useLayoutEffect" not in s.split('from "react";')[0]:
    s = s.replace("  useEffect,\n", "  useEffect,\n  useLayoutEffect,\n", 1)

# ---- provider badge: a class instead of a pressable style function ----
start = s.index("function makeBadgePressableStyle(")
end = s.index("function pickSheetModel(")
s = s[:start] + s[end:]
rep('''  const providerAnchorRef = useRef<View>(null);
  const _modelAnchorRef = useRef<View>(null);''', '''  const providerAnchorRef = useRef<HTMLButtonElement | null>(null);''')
rep('''  const providerPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectProvider,
        openSelector === "provider",
      ),
    [canSelectProvider, disabled, openSelector],
  );''', '''  const providerPressableClassName = cn(
    "flex h-7 items-center gap-1 rounded-md px-2 hover:bg-muted",
    openSelector === "provider" && "bg-background",
    (disabled || !canSelectProvider) && "opacity-50",
  );''')
rep("            providerPressableStyle={providerPressableStyle}\n",
    "            providerPressableClassName={providerPressableClassName}\n")
rep('''  providerAnchorRef: RefObject<View | null>;
  providerPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;''',
    '''  providerAnchorRef: RefObject<HTMLButtonElement | null>;
  providerPressableClassName: string;''')
rep("    providerPressableStyle,\n", "    providerPressableClassName,\n")

# ---- the controls row measures its own width (density) ----
rep('''  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const availableWidth = readMeasuredWidth(event);
      if (availableWidth === null) return;
      availableWidthRef.current = availableWidth;
      updateDensityForWidth(availableWidth);
    },
    [updateDensityForWidth],
  );''', '''  // The row lays out for the width it gets. A hidden composer measures 0: that is "not
  // rendered", not "very narrow", so it never changes the density.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleWidth = useCallback(
    (availableWidth: number) => {
      if (availableWidth <= 0) return;
      availableWidthRef.current = availableWidth;
      updateDensityForWidth(availableWidth);
    },
    [updateDensityForWidth],
  );
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    handleWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) handleWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [handleWidth, hasAnyControl]);''')
rep('''      <View style={styles.container} onLayout={handleLayout}>''',
    '''      <div ref={containerRef} className="flex min-w-0 shrink grow items-center gap-1 overflow-hidden">''')

# ---- desktop content ----
rep('''            <Text style={styles.modeBadgeText}>{displayProvider}</Text>''',
    '''            <span className="min-w-0 shrink truncate text-sm text-muted-foreground">{displayProvider}</span>''')
rep('''            style={providerPressableStyle}\n''', '''            className={providerPressableClassName}\n''')
rep('''            <View style={styles.modelControl}>''', '''            <div className="min-w-0 shrink">''')
s, n = re.subn(r"<Text style=\{styles\.tooltipText\}>(.*?)</Text>", r"<span>\1</span>", s, flags=re.S)
if n != 2:
    raise SystemExit(f"tooltip texts: {n}")
rep('''          <Pressable
            onPress={handleOpenFeatures}
            disabled={disabled}
            style={styles.modeIconBadge}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.features.open")}
            testID="agent-controls-features"
          >
            <ComposerToolbarGlyph size={glyphSize}>
              <Settings2 size={glyphSize} color={theme.colors.foregroundMuted} />
            </ComposerToolbarGlyph>
          </Pressable>''', '''          <button
            type="button"
            onClick={handleOpenFeatures}
            disabled={disabled}
            aria-label={t("agentControls.features.open")}
            data-testid="agent-controls-features"
            className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
          >
            <ComposerToolbarGlyph size={glyphSize}>
              <Settings2 size={glyphSize} className="text-muted-foreground" />
            </ComposerToolbarGlyph>
          </button>''')
# DesktopAgentControlsContent no longer reads the theme
start = s.index("function DesktopAgentControlsContent(props: DesktopAgentControlsContentProps) {")
head, tail = s[:start], s[start:]
tail = tail.replace("  const { theme } = useUnistyles();\n", "", 1)
s = head + tail

# ---- sheet content ----
rep('''    <View style={styles.combinedSheetControls} testID="agent-controls-combined-sheet-controls">''',
    '''    <div className="flex flex-col gap-1" data-testid="agent-controls-combined-sheet-controls">''')
rep('''  const featureAnchorRef = useRef<View>(null);''', '''  const featureAnchorRef = useRef<HTMLButtonElement | null>(null);''')

# ---- leftovers ----
s = re.sub(r"\n\s*collapsable=\{false\}", "", s)
s = re.sub(r'\n\s*accessibilityRole="button"', "", s)
s = s.replace("</View>", "</div>")
start = s.index("const styles = StyleSheet.create(")
s = s[:start].rstrip() + "\n"

for needle in ["<View", "<Text", "<Pressable", "styles.", "StyleSheet", "PressableStateCallbackType",
               "StyleProp", "ViewStyle", "LayoutChangeEvent", "readMeasuredWidth"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-200:i+200]}")
s = f"""// Override of packages/app/src/composer/agent-controls/index.tsx. The control logic is the Expo
// file's (live and draft controls, density, profiles, command-center registration); the view is DOM.
// Generated from the Expo file by web/scripts/port/agent-controls.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
""" + s
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
