#!/usr/bin/env python3
"""Port packages/app's agent-stream/view.tsx to web/src/overrides: same logic, DOM + Tailwind view."""
import os

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/agent-stream/view.tsx")
DST = str(ROOT / "web/src/overrides/agent-stream/view.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:300]}\n--- found {n}")
    s = s.replace(old, new)


# ---- imports ----
rep('import { LoadingSpinner } from "@/components/ui/loading-spinner";\n', 'import { Spinner } from "~/components/ui/spinner";\n')
rep('''import {
  View,
  Text,
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
''', '''import { useIsCompactFormFactor } from "@/constants/layout";
''')
rep('import Animated, { FadeIn, FadeOut } from "react-native-reanimated";\n', "")
rep('import { Check, ChevronDown, X } from "lucide-react-native";', 'import { Check, ChevronDown, X } from "lucide-react";')
rep('import type { Theme } from "@/styles/theme";\n', 'import { cn } from "cn";\n')
for rel in [
    "timeline-tail-navigation",
    "model",
    "strategy-web",
    "strategy",
    "turn-footer",
    "bottom-overlay-inset",
    "layout",
    "bottom-anchor-controller",
    "use-stream-history-window",
]:
    rep(f'from "./{rel}";', f'from "@/agent-stream/{rel}";')

# ---- live auxiliary, permissions, empty state ----
rep('''      {input.pendingPermissions ? (
        <View style={stylesheet.contentWrapper}>
          <View style={stylesheet.listHeaderContent}>{input.pendingPermissions}</View>
        </View>
      ) : null}''', '''      {input.pendingPermissions ? (
        <div className={CONTENT_COLUMN}>
          <div className="flex flex-col gap-3">{input.pendingPermissions}</div>
        </div>
      ) : null}''')
rep('''function BottomOverlayInset({ height }: { height: number }) {
  const style = useMemo(() => ({ height }), [height]);
  return <View style={style} />;
}''', '''function BottomOverlayInset({ height }: { height: number }) {
  const style = useMemo(() => ({ height }), [height]);
  return <div style={style} />;
}''')
rep('''  return (
    <View style={stylesheet.permissionsContainer}>
      {input.pendingPermissions.map((permission) => (
        <PermissionRequestCard key={permission.key} permission={permission} client={input.client} />
      ))}
    </View>
  );''', '''  return (
    <div className="flex flex-col gap-2">
      {input.pendingPermissions.map((permission) => (
        <PermissionRequestCard key={permission.key} permission={permission} client={input.client} />
      ))}
    </div>
  );''')
rep('''  const handlePress = useCallback(() => onSelect?.(prompt), [onSelect, prompt]);
  return (
    <Pressable onPress={handlePress} style={stylesheet.suggestionChip}>
      <Text style={stylesheet.suggestionChipText}>{label}</Text>
    </Pressable>
  );''', '''  const handlePress = useCallback(() => onSelect?.(prompt), [onSelect, prompt]);
  return (
    <button
      type="button"
      onClick={handlePress}
      className="rounded-md border px-3 py-2 text-xs text-foreground hover:bg-muted"
    >
      {label}
    </button>
  );''')
rep('''  emptyStateStyle: StyleProp<ViewStyle>;''', '''  emptyStateClassName: string;''')
rep('''  return (
    <View style={input.emptyStateStyle}>
      <Text style={stylesheet.emptyStateText}>{input.emptyText}</Text>
      {input.suggestions && input.suggestions.length > 0 ? (
        <View style={stylesheet.emptySuggestions}>''', '''  return (
    <div className={input.emptyStateClassName}>
      <span className="text-center text-sm text-muted-foreground">{input.emptyText}</span>
      {input.suggestions && input.suggestions.length > 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2">''')
rep('''              onSelect={input.onSuggestionSelect}
            />
          ))}
        </View>
      ) : null}
    </View>
  );''', '''              onSelect={input.onSuggestionSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );''')

# ---- view body ----
rep('''    const scrollIndicatorFadeIn = FadeIn.duration(200);
    const scrollIndicatorFadeOut = FadeOut.duration(200);
''', "")
rep('''            {parentRow}
            <View style={stylesheet.nestedCodemodeChildren}>''', '''            {parentRow}
            {/* The rail drops from the centre of the parent's glyph (the badge pulls out 13 and
                pads 8, so the glyph centre is at 6); child rows indent one step past it. */}
            <div className="ml-1.5 flex flex-col gap-1 border-l pl-3">''')
rep('''                </React.Fragment>
              ))}
            </View>
          </React.Fragment>''', '''                </React.Fragment>
              ))}
            </div>
          </React.Fragment>''')
rep('''    const emptyStateStyle = useMemo(() => [stylesheet.emptyState, stylesheet.contentWrapper], []);
    const scrollToBottomContainerStyle = useMemo(
      () => [
        stylesheet.scrollToBottomContainer,
        { bottom: resolveBottomOverlayControlOffset(bottomOverlayControlClearance) },
      ],
      [bottomOverlayControlClearance],
    );''', '''    const scrollToBottomContainerStyle = useMemo(
      () => ({ bottom: resolveBottomOverlayControlOffset(bottomOverlayControlClearance) }),
      [bottomOverlayControlClearance],
    );''')
rep('''          renderModel,
          emptyStateStyle,
          emptyText: t("agentStream.empty"),''', '''          renderModel,
          emptyStateClassName: EMPTY_STATE,
          emptyText: t("agentStream.empty"),''')
rep('''      [renderModel, emptyStateStyle, t, emptySuggestions, onEmptySuggestionSelect],''', '''      [renderModel, t, emptySuggestions, onEmptySuggestionSelect],''')
rep('''        <AssistantSelectionCopySurface style={stylesheet.container}>''', '''        <AssistantSelectionCopySurface className="bg-background">''')
rep('''              scrollEnabled: true,
              listStyle: stylesheet.list,
              baseListContentContainerStyle: stylesheet.listContentContainer,
              forwardListContentContainerStyle: stylesheet.forwardListContentContainer,
            })}''', '''              scrollEnabled: true,
              // The web strategy lays its list out itself; these React Native styles are unused.
              listStyle: undefined,
              baseListContentContainerStyle: undefined,
              forwardListContentContainerStyle: undefined,
            })}''')
rep('''            <View style={scrollToBottomContainerStyle} pointerEvents="box-none">
              <Animated.View entering={scrollIndicatorFadeIn} exiting={scrollIndicatorFadeOut}>
                <Pressable
                  style={stylesheet.scrollToBottomButton}
                  onPress={handleScrollToBottomPress}
                  accessibilityRole="button"
                  accessibilityLabel={t("agentStream.scrollToBottom")}
                  testID="scroll-to-bottom-button"
                >
                  <ChevronDown size={24} color={stylesheet.scrollToBottomIcon.color} />
                </Pressable>
              </Animated.View>
            </View>,''', '''            <div
              className="pointer-events-none absolute inset-x-0 flex flex-col items-center"
              style={scrollToBottomContainerStyle}
            >
              <button
                type="button"
                onClick={handleScrollToBottomPress}
                aria-label={t("agentStream.scrollToBottom")}
                data-testid="scroll-to-bottom-button"
                className="pointer-events-auto flex size-12 animate-in items-center justify-center rounded-full bg-muted text-foreground shadow-sm duration-200 fade-in-0"
              >
                <ChevronDown size={24} />
              </button>
            </div>,''')

# ---- permission card ----
start = s.index("const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);")
end = s.index("function PermissionRequestCard({")
s = s[:start] + '''interface PermissionActionButtonProps {
  action: AgentPermissionAction;
  isRespondingAction: boolean;
  isResponding: boolean;
  isPrimary: boolean;
  testID: string;
  onPress: (action: AgentPermissionAction) => void;
}

// Outline buttons (shadcn/ui), 28px on desktop.
function PermissionActionButton({
  action,
  isRespondingAction,
  isResponding,
  isPrimary,
  testID,
  onPress,
}: PermissionActionButtonProps) {
  const handlePress = useCallback(() => onPress(action), [onPress, action]);
  const Icon = action.behavior === "allow" ? Check : X;
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={handlePress}
      disabled={isResponding}
      className="flex min-h-9 items-center justify-center rounded-md border border-input bg-background px-2.5 py-1 hover:bg-muted active:opacity-90 disabled:pointer-events-none md:min-h-7 dark:bg-input/30 dark:hover:bg-input/50"
    >
      {isRespondingAction ? (
        <Spinner className={isPrimary ? "text-foreground" : "text-muted-foreground"} />
      ) : (
        <span className="flex items-center gap-2">
          <Icon size={14} className={isPrimary ? "text-foreground" : "text-muted-foreground"} />
          <span className="text-sm font-medium text-foreground">{action.label}</span>
        </span>
      )}
    </button>
  );
}

''' + s[end:]
rep('''  const optionsContainerStyle = useMemo(
    () => [
      permissionStyles.optionsContainer,
      !isMobile && permissionStyles.optionsContainerDesktop,
    ],
    [isMobile],
  );
''', '')
rep('''      <Text testID="permission-request-question" style={permissionStyles.question}>
        {t("agentStream.permission.question")}
      </Text>

      <View style={optionsContainerStyle}>''', '''      <span data-testid="permission-request-question" className="my-1 text-sm text-muted-foreground">
        {t("agentStream.permission.question")}
      </span>

      <div className={cn("flex gap-2", isMobile ? "flex-col" : "w-full flex-row flex-wrap items-center justify-start")}>''')
rep('''          const isRespondingAction = respondingActionId === action.id;
          const Icon = action.behavior === "allow" ? ThemedCheckIcon : ThemedXIcon;
''', '''          const isRespondingAction = respondingActionId === action.id;
''')
rep('''              isPrimary={isPrimary}
              Icon={Icon}
              testID={testID}''', '''              isPrimary={isPrimary}
              testID={testID}''')
rep('''          );
        })}
      </View>
    </>
  );''', '''          );
        })}
      </div>
    </>
  );''')
rep('''  return (
    <View style={permissionStyles.container}>
      <Text style={permissionStyles.title}>{title}</Text>

      {description ? <Text style={permissionStyles.description}>{description}</Text> : null}
''', '''  // shadcn/ui card: hairline frame, 14px radius, shadow-xs.
  return (
    <div className="my-3 flex flex-col gap-2 rounded-xl border bg-card px-3.5 py-3 shadow-xs">
      <span className="text-sm leading-[22px] font-medium text-foreground">{title}</span>

      {description ? <span className="text-sm leading-5 text-muted-foreground">{description}</span> : null}
''')
rep('''      {footer}
    </View>
  );
}''', '''      {footer}
    </div>
  );
}''')

# ---- styles ----
start = s.index("const stylesheet = StyleSheet.create((theme) => ({")
end = s.index("interface StreamItemWrapperProps {")
s = s[:start] + '''// One column of the conversation: 820px wide at most, centred, 8px gutters.
const CONTENT_COLUMN = "mx-auto w-full max-w-[820px] px-2";
const EMPTY_STATE = cn("flex flex-1 flex-col items-center justify-center py-12", CONTENT_COLUMN);

''' + s[end:]
rep('''function StreamItemWrapper({ gapBelow, children }: StreamItemWrapperProps) {
  const wrapperStyle = useMemo(
    () => [stylesheet.streamItemWrapper, { marginBottom: gapBelow }],
    [gapBelow],
  );
  return <View style={wrapperStyle}>{children}</View>;
}''', '''function StreamItemWrapper({ gapBelow, children }: StreamItemWrapperProps) {
  const wrapperStyle = useMemo(() => ({ marginBottom: gapBelow }), [gapBelow]);
  return (
    <div className={cn("flex flex-col", CONTENT_COLUMN)} style={wrapperStyle}>
      {children}
    </div>
  );
}''')

for needle in ["<View", "<Text", "<Pressable", "stylesheet.", "permissionStyles", "StyleSheet", "withUnistyles", "uniProps", "Animated"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-160:i+160]}")
s = """// Override of packages/app/src/agent-stream/view.tsx. The stream logic is the Expo file's (tool-call
// grouping and detail levels, nested codemode, subagents, forks, the outline, history paging);
// the view is DOM and Tailwind. Keep the two in step until the cutover deletes packages/app.
// Generated from the Expo file by web/scripts/port/agent-stream-view.py.\n// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n""" + s
os.makedirs(os.path.dirname(DST), exist_ok=True)
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
