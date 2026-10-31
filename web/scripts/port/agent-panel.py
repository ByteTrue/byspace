#!/usr/bin/env python3
"""Port packages/app's panels/agent-panel.tsx to web/src/overrides: same logic, DOM + Tailwind view."""
import re

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/panels/agent-panel.tsx")
DST = str(ROOT / "web/src/overrides/panels/agent-panel.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:300]}\n--- found {n}")
    s = s.replace(old, new)


# ---- imports ----
rep('import { LoadingSpinner } from "@/components/ui/loading-spinner";\n', "")
rep('import { ArrowDownToLine, ListChevronsDownUp, SquarePen } from "lucide-react-native";',
    'import { ArrowDownToLine, ListChevronsDownUp, SquarePen } from "lucide-react";')
rep('''  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";''', '''  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";''')
rep('''import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
''', "")
rep('import { KeyboardDock } from "@/components/keyboard-dock";\n', "")
rep('''import {
  composerPillStyles,
  resolveComposerTrackControlClearance,''', '''import {
  composerPillClassName,
  resolveComposerTrackControlClearance,''')
rep('''import {
  COMPACT_FORM_FACTOR_WIDTH,
  MAX_CONTENT_WIDTH,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";
''', '''import { COMPACT_FORM_FACTOR_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
''')
rep('import { useContainerWidthBelow } from "@/hooks/use-container-width";\n', "")
rep('import { ICON_SIZE, type Theme } from "@/styles/theme";', 'import { ICON_SIZE } from "@/styles/theme";\nimport { Spinner } from "~/components/ui/spinner";')

# ---- reconnecting toast dot (twice, different indentation) ----
s, n = re.subn(
    r'<View\n\s*accessible=\{false\}\n\s*testID="agent-reconnecting-status-dot"\n\s*style=\{styles\.reconnectingStatusDot\}\n\s*/>',
    '<span data-testid="agent-reconnecting-status-dot" className="block size-2 rounded-full bg-amber-500" />',
    s,
)
if n != 2:
    raise SystemExit(f"reconnecting dot: {n}")

# ---- spinners ----
s, n = re.subn(r'<ThemedLoadingSpinner size="large" uniProps=\{foregroundMutedColorMapping\} />',
               '<Spinner className="size-8 text-muted-foreground" />', s)
if n < 3:
    raise SystemExit(f"muted spinners: {n}")
rep('<ThemedLoadingSpinner size="large" uniProps={foregroundColorMapping} />', '<Spinner className="size-8 text-foreground" />')

# ---- chat surface ----
rep('''  const streamContent = (
    <View style={animatedStaticStyles.content}>''', '''  const streamContent = (
    <div className="relative flex min-h-0 flex-1 flex-col">''')
rep('''          actions={streamControls}
        />
      ) : null}
    </View>
  );
  const contentContainer = <View style={styles.contentContainer}>{streamContent}</View>;''', '''          actions={streamControls}
        />
      ) : null}
    </div>
  );
  const contentContainer = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden select-none">{streamContent}</div>
  );''')
rep('''      <View style={styles.root} collapsable={false}>''', '''      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">''')
rep('''          </View>
        ) : null}
      </View>
    </RewindComposerRestoreProvider>''', '''          </div>
        ) : null}
      </div>
    </RewindComposerRestoreProvider>''')
rep('''function DockedChatSurface({ children, disabled }: { children: ReactNode; disabled: boolean }) {
  return (
    <KeyboardDock style={styles.container}>
      <FileDropZone style={styles.container} disabled={disabled}>
        {children}
      </FileDropZone>
    </KeyboardDock>
  );
}''', '''function DockedChatSurface({ children, disabled }: { children: ReactNode; disabled: boolean }) {
  return (
    <FileDropZone className="flex min-h-0 flex-1 flex-col bg-background" disabled={disabled}>
      {children}
    </FileDropZone>
  );
}''')

# ---- stream controls ----
start = s.index("const AgentStreamControlButton = memo(function AgentStreamControlButton({")
end = s.index("const AgentComposerSection = memo(function AgentComposerSection({")
s = s[:start] + '''const AgentStreamControlButton = memo(function AgentStreamControlButton({
  Icon,
  onPress,
  accessibilityLabel,
  testID,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  return (
    <Tooltip delayDuration={300} enabledOnDesktop>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onPress}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          aria-label={accessibilityLabel}
          data-testid={testID}
          className={composerPillClassName(isHovered, "pointer-events-auto shrink-0 active:bg-muted")}
        >
          <Icon size={ICON_SIZE.sm} className={isHovered ? "text-foreground" : "text-muted-foreground"} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        {accessibilityLabel}
      </TooltipContent>
    </Tooltip>
  );
});

const AgentStreamHeaderControls = memo(function AgentStreamHeaderControls({
  showScrollToBottom,
  onCollapseAll,
  onScrollToBottom,
}: {
  showScrollToBottom: boolean;
  onCollapseAll: () => void;
  onScrollToBottom: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex shrink-0 items-center justify-end gap-1" data-testid="agent-stream-controls">
      {showScrollToBottom ? (
        <AgentStreamControlButton
          Icon={ArrowDownToLine}
          onPress={onScrollToBottom}
          accessibilityLabel={t("agentStream.scrollToBottom")}
          testID="scroll-to-bottom-button"
        />
      ) : null}
      <AgentStreamControlButton
        Icon={ListChevronsDownUp}
        onPress={onCollapseAll}
        accessibilityLabel={t("agentStream.collapseAllToolCalls")}
        testID="collapse-all-tool-calls-button"
      />
    </div>
  );
});

''' + s[end:]

# ---- composer input area ----
rep('''  const insets = useSafeAreaInsets();
  const isCompactFormFactor = useIsCompactFormFactor();
  const { onLayout: onInputAreaLayout, isBelow: isCompactComposerLayout } = useContainerWidthBelow(
    COMPACT_FORM_FACTOR_WIDTH,
    { initialIsBelow: isCompactFormFactor },
  );''', '''  const isCompactFormFactor = useIsCompactFormFactor();
  // The composer lays out for its own width, not the window's. A retained, hidden panel measures
  // 0: that is "not rendered", not "very narrow", so it never flips the layout.
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
rep('''  const inputAreaStyle = useMemo(
    () => [animatedStaticStyles.inputAreaWrapper, { paddingBottom: insets.bottom }],
    [insets.bottom],
  );

  return (
    <View style={inputAreaStyle} onLayout={onInputAreaLayout}>
      <Composer''', '''  return (
    <div ref={inputAreaRef} className="w-full shrink pb-[env(safe-area-inset-bottom)]">
      <Composer''')
rep('''        isCompactLayout={isCompactComposerLayout}
      />
    </View>
  );
}''', '''        isCompactLayout={isCompactComposerLayout}
      />
    </div>
  );
}''')

# ---- drop the style objects ----
start = s.index("const ThemedArrowDownToLine = withUnistyles(ArrowDownToLine);")
s = s[:start].rstrip() + "\n"

# ---- generic View/Text with a styles key ----
CLASSES = {
    "container": "flex min-h-0 flex-1 flex-col bg-background",
    "errorContainer": "flex flex-1 flex-col items-center justify-center",
    "errorText": "text-center text-sm text-muted-foreground",
    "statusText": "mt-2 text-center text-sm text-muted-foreground",
    "errorAction": "mt-4",
    "timelineSyncCalloutRail": "flex w-full flex-col items-center px-4 pt-2",
    "timelineSyncCalloutContent": "w-full max-w-[820px]",
    "timelineSyncCallout": "flex items-center justify-center gap-3 rounded-2xl border border-status-danger bg-card px-4 py-2",
    "timelineSyncCalloutText": "text-sm text-muted-foreground",
    "historySyncOverlay": "absolute inset-0 z-40 flex items-center justify-center bg-background",
    "archivingOverlay": "absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[rgba(8,10,14,0.86)] px-8",
    "archivingTitle": "text-center text-sm font-semibold text-foreground",
    "archivingSubtitle": "text-center text-sm text-muted-foreground",
    "centerState": "flex flex-1 flex-col items-center justify-center gap-3 px-6",
    "loadingText": "text-sm text-muted-foreground",
    "offlineTitle": "text-center text-sm font-semibold text-foreground",
    "offlineDescription": "text-center text-sm text-muted-foreground",
    "offlineDetails": "text-center text-xs text-muted-foreground",
}


def view_sub(match):
    tag, key = match.group(1), match.group(2)
    if key not in CLASSES:
        raise SystemExit(f"no class for styles.{key}")
    html = "div" if tag == "View" else "span"
    return f'<{html} className="{CLASSES[key]}"'


s = re.sub(r"<(View|Text) style=\{styles\.(\w+)\}", view_sub, s)
s = s.replace("</View>", "</div>").replace("</Text>", "</span>")
s = re.sub(r'(<(?:div|span)[^>]*?)\btestID=', r"\1data-testid=", s)

for needle in ["<View", "<Text", "<Pressable", "styles.", "StyleSheet", "withUnistyles", "uniProps", "Themed", "insets"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-200:i+200]}")
s = """// Override of packages/app/src/panels/agent-panel.tsx. The panel logic is the Expo file's (load and
// lookup states, reconnect toast, attention clearing, history sync, archive, tracks, rewind
// restore); the view is DOM and Tailwind. Keep the two in step until the cutover.
// Generated from the Expo file by web/scripts/port/agent-panel.py.\n// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n""" + s
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
