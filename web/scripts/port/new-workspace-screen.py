#!/usr/bin/env python3
"""Port packages/app's New workspace screen (screens/new-workspace-screen.tsx) to web/src/overrides:
the pickers' state, workspace creation (local, worktree, empty, chat agent, terminal launch),
drafts and handoff are the Expo file's; the view is DOM. Icons keep reading the live theme through
the react-native-unistyles shim (`useUnistyles`, `withUnistyles`)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "packages/app/src"
OVR = ROOT / "web/src/overrides"

state = {"s": (APP / "screens/new-workspace-screen.tsx").read_text(encoding="utf-8")}


def rep(old, new, count=1):
    n = state["s"].count(old)
    if n != count:
        raise SystemExit(f"new-workspace: expected {count} of:\n{old[:300]}\n--- found {n}")
    state["s"] = state["s"].replace(old, new)


BADGE_ICON_BOX = "flex size-4 shrink-0 items-center justify-center"
BADGE_TEXT = "min-w-0 shrink truncate text-sm text-muted-foreground"
ROW_ICON_BOX = "flex size-4 items-center justify-center"

# ---------------------------------------------------------------- imports
rep('import { Pressable, StyleSheet as RNStyleSheet, Text, View } from "react-native";\n', "")
rep('import type { PressableStateCallbackType, StyleProp, ViewStyle } from "react-native";\n', "")
rep('import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";',
    'import { useUnistyles, withUnistyles } from "react-native-unistyles";')
rep('import { useSafeAreaInsets } from "react-native-safe-area-context";\n', "")
rep('} from "lucide-react-native";', '} from "lucide-react";')
rep('import { ICON_SIZE, type Theme } from "@/styles/theme";',
    'import { ICON_SIZE, type Theme } from "@/styles/theme";\nimport type { CSSProperties } from "react";\nimport { cn } from "cn";')
# Relative imports would resolve next to this override; go through `@/screens/`.
state["s"] = re.sub(r'from "\./', 'from "@/screens/', state["s"])

# ---------------------------------------------------------------- constants
rep("const PROJECT_ICON_FALLBACK_FONT_SIZE = 10;",
    "const PROJECT_ICON_FALLBACK_FONT_SIZE = 10;\n"
    "const PROJECT_ICON_FALLBACK_TEXT: CSSProperties = {\n"
    "  fontSize: PROJECT_ICON_FALLBACK_FONT_SIZE,\n"
    "  fontWeight: 600,\n"
    "};")
rep('''// Height of a single picker-trigger badge. The Base-row spacer reserves exactly
// this so toggling Isolation to Local hides the row without shifting the form.
const BADGE_HEIGHT = 28;
''', '''// A picker-trigger badge: 28px tall, the same height the compact form's spacer reserves, so
// toggling Isolation to Local hides the Base row without shifting the form.
const BADGE =
  "flex h-7 max-w-60 min-w-0 shrink items-center gap-1 overflow-hidden rounded-2xl px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 enabled:hover:bg-muted enabled:active:bg-background";
// The badge's own padding is offset so the project icon lands on the title's left edge.
const CENTERED_CONTENT_STYLE: CSSProperties = { paddingBottom: HEADER_INNER_HEIGHT + 24 };
const CONTENT_WIDTH_STYLE: CSSProperties = { maxWidth: MAX_CONTENT_WIDTH };
''')

# ---------------------------------------------------------------- small views
rep('''    <View style={styles.chevronContainer}>
      <ThemedChevronDown size={ICON_SIZE.sm} uniProps={chevronExtraMutedMapping} />
    </View>''', '''    <span className="flex shrink-0 translate-y-px">
      <ThemedChevronDown size={ICON_SIZE.sm} uniProps={chevronExtraMutedMapping} />
    </span>''')

rep('''      <View style={styles.badgeIconBox}>
        {selectedItem?.kind === "github-pr" ? (
          <GitPullRequest size={iconSize} color={iconColor} />
        ) : (
          <GitBranch size={iconSize} color={iconColor} />
        )}
      </View>
      <Text style={styles.badgeText} numberOfLines={1}>
        {triggerLabel}
      </Text>''', f'''      <span className="{BADGE_ICON_BOX}">
        {{selectedItem?.kind === "github-pr" ? (
          <GitPullRequest size={{iconSize}} color={{iconColor}} />
        ) : (
          <GitBranch size={{iconSize}} color={{iconColor}} />
        )}}
      </span>
      <span className="{BADGE_TEXT}">{{triggerLabel}}</span>''')

# The host control first: its Pressable's lines contain the trigger patterns below.
rep('''  desktopControlStyle?: StyleProp<ViewStyle>;''', '''  desktopControlClassName?: string;''')
rep('''  badgePressableStyle: (
    state: PressableStateCallbackType & { hovered?: boolean },
  ) => StyleProp<ViewStyle>;''', '''  badgeClassName: string;''')
rep('''    desktopControlStyle,
    host,
    isPending,
    selectedHostLabel,
    badgePressableStyle,
    tooltipText,''', '''    desktopControlClassName,
    host,
    isPending,
    selectedHostLabel,
    badgeClassName,
    tooltipText,''')
rep('''    <View style={desktopControlStyle}>
      <HostPicker''', '''    <div className={desktopControlClassName}>
      <HostPicker''')
rep('''            <Pressable
              ref={host.anchorRef}
              accessibilityRole="button"
              accessibilityLabel="Host"
              onPress={host.open}
              disabled={isPending}
              style={badgePressableStyle}
              testID="host-picker-trigger"
            >
              <View style={styles.badgeIconBox}>
                <HostStatusDot serverId={host.selectedServerId} />
              </View>
              <Text style={styles.badgeText} numberOfLines={1}>
                {selectedHostLabel}
              </Text>
              {metaChevron}
            </Pressable>''', f'''            <button
              type="button"
              ref={{host.anchorRef}}
              aria-label="Host"
              onClick={{host.open}}
              disabled={{isPending}}
              className={{badgeClassName}}
              data-testid="host-picker-trigger"
            >
              <span className="{BADGE_ICON_BOX}">
                <HostStatusDot serverId={{host.selectedServerId}} />
              </span>
              <span className="{BADGE_TEXT}">{{selectedHostLabel}}</span>
              {{metaChevron}}
            </button>''')
rep('''            <Text style={styles.tooltipText}>{tooltipText}</Text>''', '''            {tooltipText}''')
rep('''      </HostPicker>
    </View>''', '''      </HostPicker>
    </div>''')

# Trigger props: a DOM anchor and the badge classes.
rep("  pickerAnchorRef: React.RefObject<View | null>;", "  pickerAnchorRef: React.RefObject<HTMLButtonElement | null>;", 3)
rep('  badgePressableStyle: React.ComponentProps<typeof Pressable>["style"];', "  badgeClassName: string;", 3)
rep("\n  badgePressableStyle,\n", "\n  badgeClassName,\n", 3)
rep("\n          style={badgePressableStyle}\n", "\n          className={badgeClassName}\n", 3)
rep('\n          accessibilityRole="button"\n', "\n", 3)
rep("        <Text style={styles.tooltipText}>{tooltipLabel}</Text>", "        {tooltipLabel}", 3)

rep('''          <View style={styles.badgeIconBox}>
            {projectViewKey ? (
              <ProjectIconView
                iconDataUri={iconDataUri}
                initial={placeholderInitial}
                projectViewKey={projectViewKey}
                size={ICON_SIZE.md}
                textStyle={styles.projectIconFallbackText}
              />
            ) : (
              <Folder size={iconSize} color={iconColor} />
            )}
          </View>
          <Text style={styles.badgeText} numberOfLines={1}>
            {label}
          </Text>''', f'''          <span className="{BADGE_ICON_BOX}">
            {{projectViewKey ? (
              <ProjectIconView
                iconDataUri={{iconDataUri}}
                initial={{placeholderInitial}}
                projectViewKey={{projectViewKey}}
                size={{ICON_SIZE.md}}
                textStyle={{PROJECT_ICON_FALLBACK_TEXT}}
              />
            ) : (
              <Folder size={{iconSize}} color={{iconColor}} />
            )}}
          </span>
          <span className="{BADGE_TEXT}">{{label}}</span>''')

rep('''      <View style={styles.rowIconBox}>
        {isBranch ? (
          <GitBranch size={iconSize} color={iconColor} />
        ) : (
          <GitPullRequest size={iconSize} color={iconColor} />
        )}
      </View>''', f'''      <span className="{ROW_ICON_BOX}">
        {{isBranch ? (
          <GitBranch size={{iconSize}} color={{iconColor}} />
        ) : (
          <GitPullRequest size={{iconSize}} color={{iconColor}} />
        )}}
      </span>''')
rep('''      trailingLabel ? <Text style={styles.refDivergenceLabel}>{trailingLabel}</Text> : undefined,''',
    '''      trailingLabel ? (
        <span className="text-xs text-muted-foreground tabular-nums">{trailingLabel}</span>
      ) : undefined,''')
rep('''      <View style={styles.rowIconBox}>
        {optionId === "worktree" ? (
          <GitBranch size={iconSize} color={iconColor} />
        ) : (
          <Folder size={iconSize} color={iconColor} />
        )}
      </View>''', f'''      <span className="{ROW_ICON_BOX}">
        {{optionId === "worktree" ? (
          <GitBranch size={{iconSize}} color={{iconColor}} />
        ) : (
          <Folder size={{iconSize}} color={{iconColor}} />
        )}}
      </span>''')
rep('''      <View style={styles.rowIconBox}>
        <ProjectIconView
          iconDataUri={iconDataUri}
          initial={placeholderInitial}
          projectViewKey={projectViewKey}
          size={ICON_SIZE.md}
          textStyle={styles.projectIconFallbackText}
        />
      </View>''', f'''      <span className="{ROW_ICON_BOX}">
        <ProjectIconView
          iconDataUri={{iconDataUri}}
          initial={{placeholderInitial}}
          projectViewKey={{projectViewKey}}
          size={{ICON_SIZE.md}}
          textStyle={{PROJECT_ICON_FALLBACK_TEXT}}
        />
      </span>''')
rep("  if (!item) return <View key={option.id} />;", "  if (!item) return null;")
rep("  if (!project) return <View key={option.id} />;", "  if (!project) return null;")

rep('''          <View style={styles.badgeIconBox}>
            {isolation === "worktree" ? (
              <GitBranch size={iconSize} color={iconColor} />
            ) : (
              <Folder size={iconSize} color={iconColor} />
            )}
          </View>
          <Text style={styles.badgeText} numberOfLines={1}>
            {label}
          </Text>''', f'''          <span className="{BADGE_ICON_BOX}">
            {{isolation === "worktree" ? (
              <GitBranch size={{iconSize}} color={{iconColor}} />
            ) : (
              <Folder size={{iconSize}} color={{iconColor}} />
            )}}
          </span>
          <span className="{BADGE_TEXT}">{{label}}</span>''')

rep("  return <View style={styles.row}>{children}</View>;",
    '  return <div className="flex items-center gap-1 pl-4">{children}</div>;')

rep('''function getContentStyle(input: { isCompact: boolean; insetBottom: number }) {
  if (input.isCompact) {
    return [styles.content, styles.contentCompact, { paddingBottom: input.insetBottom }];
  }
  return [styles.content, styles.contentCentered];
}''', '''function getContentLayout(input: { isCompact: boolean }): { className: string; style?: CSSProperties } {
  if (input.isCompact) {
    return {
      className:
        "relative flex min-h-0 flex-1 flex-col items-center justify-end pb-[env(safe-area-inset-bottom)]",
    };
  }
  return {
    className: "relative flex min-h-0 flex-1 flex-col items-center justify-center",
    style: CENTERED_CONTENT_STYLE,
  };
}''')

# ---------------------------------------------------------------- form stack
rep("  anchorRef: RefObject<View | null>;", "  anchorRef: RefObject<HTMLButtonElement | null>;")
rep('''  const badgePressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.badge,
      Boolean(hovered) && !isPending && styles.badgeHovered,
      pressed && !isPending && styles.badgePressed,
      isPending && styles.badgeDisabled,
    ],
    [isPending],
  );

  const desktopControlStyle = isCompact ? undefined : styles.desktopControl;''',
    '''  const badgeClassName = cn(BADGE, isPending && "opacity-60");

  const desktopControlClassName = isCompact ? undefined : "min-w-0 shrink";''')
rep("    <View style={desktopControlStyle}>\n", "    <div className={desktopControlClassName}>\n", 3)
rep("\n        badgePressableStyle={badgePressableStyle}\n", "\n        badgeClassName={badgeClassName}\n", 3)
rep("      desktopControlStyle={desktopControlStyle}\n", "      desktopControlClassName={desktopControlClassName}\n")
rep("\n      badgePressableStyle={badgePressableStyle}\n", "\n      badgeClassName={badgeClassName}\n", 2)
rep('''        footer={addProjectAction}
      />
    </View>''', '''        footer={addProjectAction}
      />
    </div>''')
rep('''        renderOption={isolation.renderOption}
      />
    </View>''', '''        renderOption={isolation.renderOption}
      />
    </div>''')
rep('''        renderOption={base.renderOption}
      />
    </View>''', '''        renderOption={base.renderOption}
      />
    </div>''')
rep('''    <View testID="new-workspace-ref-picker-row" style={styles.formStack}>
      <FormRow>{projectControl}</FormRow>
      {hostControl ? <FormRow>{hostControl}</FormRow> : null}
      {isolationControl ? <FormRow>{isolationControl}</FormRow> : null}
      {baseControl ? <FormRow>{baseControl}</FormRow> : null}
      <FormRow>{launchControl}</FormRow>
      {/* Keep fixed stack height without separating the visible controls. */}
      {isolationControl ? null : <View style={styles.baseSpacer} />}
      {baseControl ? null : <View style={styles.baseSpacer} />}
    </View>
  ) : (
    <View testID="new-workspace-ref-picker-row" style={styles.formStackDesktop}>
      {projectControl}
      {hostControl}
      {isolationControl}
      {baseControl}
      <View style={styles.launchSpacer} />
      {launchControl}
    </View>
  );''', '''    <div data-testid="new-workspace-ref-picker-row" className="mb-8 flex flex-col gap-2">
      <FormRow>{projectControl}</FormRow>
      {hostControl ? <FormRow>{hostControl}</FormRow> : null}
      {isolationControl ? <FormRow>{isolationControl}</FormRow> : null}
      {baseControl ? <FormRow>{baseControl}</FormRow> : null}
      <FormRow>{launchControl}</FormRow>
      {/* Keep fixed stack height without separating the visible controls. */}
      {isolationControl ? null : <div className="h-7" />}
      {baseControl ? null : <div className="h-7" />}
    </div>
  ) : (
    <div
      data-testid="new-workspace-ref-picker-row"
      className="mb-8 flex flex-row items-center gap-2 px-4"
    >
      {projectControl}
      {hostControl}
      {isolationControl}
      {baseControl}
      {/* Pushes the launch control to the trailing edge, on the composer's inner content. */}
      <div className="flex-1" />
      {launchControl}
    </div>
  );''')

# ---------------------------------------------------------------- the screen
rep("  const insets = useSafeAreaInsets();\n", "")
rep('''  const pickerAnchorRef = useRef<View>(null);
  const projectPickerAnchorRef = useRef<View>(null);
  const isolationPickerAnchorRef = useRef<View>(null);
  const hostPickerAnchorRef = useRef<View | null>(null);''', '''  const pickerAnchorRef = useRef<HTMLButtonElement>(null);
  const projectPickerAnchorRef = useRef<HTMLButtonElement>(null);
  const isolationPickerAnchorRef = useRef<HTMLButtonElement>(null);
  const hostPickerAnchorRef = useRef<HTMLButtonElement | null>(null);''')
rep('''  const contentStyle = useMemo(
    () => getContentStyle({ isCompact, insetBottom: insets.bottom }),
    [isCompact, insets.bottom],
  );''', '''  const contentLayout = getContentLayout({ isCompact });''')
rep('''    <FileDropZone style={styles.container}>
      <ScreenHeader left={screenHeaderLeft} borderless />
      <View style={contentStyle}>
        <View style={animatedStaticStyles.centered}>
          <KeyboardTranslateView>
            <View style={styles.composerTitleContainer}>
              <Text style={styles.composerTitle}>{t("newWorkspace.title")}</Text>
            </View>''', '''    <FileDropZone className="flex min-h-0 flex-1 flex-col bg-background select-none">
      <ScreenHeader left={screenHeaderLeft} borderless />
      <div className={contentLayout.className} style={contentLayout.style}>
        <div className="w-full" style={CONTENT_WIDTH_STYLE}>
          <KeyboardTranslateView>
            <div className="mb-8 pr-4 pl-6">
              <h1 className="text-xl font-normal text-foreground">{t("newWorkspace.title")}</h1>
            </div>''')
rep('''            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          </KeyboardTranslateView>
        </View>
      </View>
    </FileDropZone>''', '''            {errorMessage ? (
              <p className="text-sm leading-5 text-destructive">{errorMessage}</p>
            ) : null}
          </KeyboardTranslateView>
        </div>
      </div>
    </FileDropZone>''')
state["s"] = state["s"][: state["s"].index("const animatedStaticStyles = RNStyleSheet.create({")].rstrip() + "\n"

for needle in ["<View", "<Text", "<Pressable", "styles.", "StyleSheet", "PressableStateCallbackType",
               "react-native\"", "useSafeAreaInsets", "insets.", "StyleProp", "ViewStyle", "accessibilityRole"]:
    if needle in state["s"]:
        i = state["s"].index(needle)
        raise SystemExit(f"new-workspace: leftover {needle}: {state['s'][i - 200:i + 200]}")

(OVR / "screens/new-workspace-screen.tsx").write_text(
    "// Override of packages/app/src/screens/new-workspace-screen.tsx: same logic, DOM view.\n"
    "// Generated from the Expo file by web/scripts/port/new-workspace-screen.py.\n"
    "// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n"
    + state["s"], encoding="utf-8")
print("ok")
