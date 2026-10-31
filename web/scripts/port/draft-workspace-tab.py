#!/usr/bin/env python3
"""Port packages/app's composer/draft/workspace-tab.tsx (the new-agent tab) to web/src/overrides."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/composer/draft/workspace-tab.tsx")
DST = str(ROOT / "web/src/overrides/composer/draft/workspace-tab.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:300]}\n--- found {n}")
    s = s.replace(old, new)


rep('''import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet as RNStyleSheet,
  Text,
  View,
} from "react-native";''', '''import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";''')
rep('import { StyleSheet } from "react-native-unistyles";\n', "")
rep('import { useSafeAreaInsets } from "react-native-safe-area-context";\n', "")
rep('import { useContainerWidthBelow } from "@/hooks/use-container-width";\n', "")
rep('import { COMPOSER_PILL_CLEARANCE } from "@/composer/pill-styles";\n', "")
rep('''import {
  COMPACT_FORM_FACTOR_WIDTH,
  MAX_CONTENT_WIDTH,
  useIsCompactFormFactor,
} from "@/constants/layout";''', '''import {
  COMPACT_FORM_FACTOR_WIDTH,
  MAX_CONTENT_WIDTH,
  useIsCompactFormFactor,
} from "@/constants/layout";
import type { CSSProperties } from "react";''')

rep('''    <Pressable
      onPress={handlePress}
      style={styles.suggestionChip}
      accessibilityRole="button"
      accessibilityLabel={prompt}
    >
      <Text style={styles.suggestionChipText}>{prompt}</Text>
    </Pressable>''', '''    <button
      type="button"
      onClick={handlePress}
      aria-label={prompt}
      className="rounded-md border px-3 py-2 text-xs text-foreground hover:bg-muted"
    >
      {prompt}
    </button>''')
rep("  const insets = useSafeAreaInsets();\n", "")
rep('''  const { onLayout: onInputAreaLayout, isBelow: isCompactComposerLayout } = useContainerWidthBelow(
    COMPACT_FORM_FACTOR_WIDTH,
    { initialIsBelow: isCompactFormFactor },
  );''', '''  // The composer lays out for its own width. A retained, hidden tab measures 0: that is
  // "not rendered", not "very narrow", so it never flips the layout.
  const inputAreaRef = useRef<HTMLDivElement | null>(null);
  const [isCompactComposerLayout, setIsCompactComposerLayout] = useState(isCompactFormFactor);
  useLayoutEffect(() => {
    const node = inputAreaRef.current;
    if (!node) return;
    const update = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) setIsCompactComposerLayout(width < COMPACT_FORM_FACTOR_WIDTH);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);''')
rep('''  const inputAreaWrapperStyle = useMemo(
    () => [animatedStaticStyles.inputAreaWrapper, { paddingBottom: insets.bottom }],
    [insets.bottom],
  );

''', "")

start = s.index("  return (\n    <FileDropZone style={styles.container}>")
end = s.index("        <Composer\n", start)
s = s[:start] + '''  return (
    <FileDropZone className="flex min-h-0 w-full flex-1 flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        {isSubmitting && draftAgent ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <AgentStreamView
              agentId={tabId}
              serverId={serverId}
              context={draftAgent}
              streamItems={submittedStreamItems}
              pendingMessageSubmissions={pendingMessageSubmissions}
              turnPresentation={turnPresentation}
              pendingPermissions={EMPTY_PENDING_PERMISSIONS}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-6">
            <div className="flex flex-col gap-3">
              {formErrorMessage ? (
                <div className="mt-2 rounded-md border border-destructive bg-muted px-3 py-2">
                  <span className="text-sm text-destructive">{formErrorMessage}</span>
                </div>
              ) : null}
            </div>
            {chiefSuggestions.length > 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-12">
                <span className="text-xs text-muted-foreground">{t("agentStream.empty")}</span>
                <div className="mt-4 flex flex-col items-center gap-2">
                  {chiefSuggestions.map((prompt) => (
                    <DraftSuggestionChip key={prompt} prompt={prompt} onSelect={handleSuggestionPress} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div ref={inputAreaRef} className="w-full shrink pb-[env(safe-area-inset-bottom)]">
        {importPillPress ? (
          <div className="flex w-full flex-col items-center px-4 py-2 md:py-2.5">
            <div className="flex w-full" style={IMPORT_PILL_CONTENT_STYLE}>
              <ComposerImportPill onPress={importPillPress} />
            </div>
          </div>
        ) : null}
''' + s[end:]
rep('''      </KeyboardTranslateView>
    </FileDropZone>''', '''      </div>
    </FileDropZone>''')
start = s.index("const animatedStaticStyles = RNStyleSheet.create({")
s = s[:start] + "const IMPORT_PILL_CONTENT_STYLE: CSSProperties = { maxWidth: MAX_CONTENT_WIDTH };\n"
rep('import { KeyboardTranslateView } from "@/components/keyboard-translate-view";\n', "")

for needle in ["<View", "<Text", "<Pressable", "<ScrollView", "styles.", "StyleSheet", "insets", "KeyboardTranslateView"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-300:i+200]}")
s = """// Override of packages/app/src/composer/draft/workspace-tab.tsx: the new-agent tab. The draft and
// create-flow logic is the Expo file's; the view is DOM and Tailwind.
// Generated from the Expo file by web/scripts/port/draft-workspace-tab.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
""" + s
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
