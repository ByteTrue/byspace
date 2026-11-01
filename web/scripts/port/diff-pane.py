#!/usr/bin/env python3
"""Port packages/app's Changes surface (git/diff-pane.tsx) and the diff panels
(panels/diff-panel.tsx) to web/src/overrides: same logic, DOM view."""
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


def replace_between(state, start_marker, end_marker, new):
    s = state["s"]
    start = s.index(start_marker)
    end = s.index(end_marker, start)
    state["s"] = s[:start] + new + s[end:]


def drop_styles(state):
    start = state["s"].index("const styles = StyleSheet.create((theme) => ({")
    state["s"] = state["s"][:start].rstrip() + "\n"


def check_leftovers(state, needles):
    for needle in needles:
        if needle in state["s"]:
            i = state["s"].index(needle)
            raise SystemExit(f"{state['name']}: leftover {needle}: {state['s'][i - 300:i + 200]}")


HEADER = """// Generated from the Expo file by web/scripts/port/diff-pane.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
"""
EXTRA_MUTED = "text-extra-muted-foreground"

# ---------------------------------------------------------------- git/diff-pane.tsx
pane = {"name": "diff-pane", "s": (APP / "git/diff-pane.tsx").read_text(encoding="utf-8")}
rep = make_rep(pane)

rep('import { useState, useCallback, useMemo, type ReactElement, type ReactNode } from "react";',
    'import {\n  Fragment,\n  useState,\n  useCallback,\n  useMemo,\n  type MouseEvent,\n'
    '  type ReactElement,\n  type ReactNode,\n} from "react";')
rep('''import {
  View,
  Text,
  Pressable,
  FlatList,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
''', "")
rep('} from "lucide-react-native";', '} from "lucide-react";')
rep('import { LoadingSpinner } from "@/components/ui/loading-spinner";',
    'import { LoadingSpinner } from "@/components/ui/loading-spinner";\nimport { cn } from "cn";')
rep('''  paneContentToolbarIconSize,
  paneContentToolbarIconButtonStyle,
  paneContentToolbarTrailingPadding,''', '''  paneContentToolbarIconSize,
  paneContentToolbarTrailingPadding,''')
rep('''import {
  extraMutedIconColorMapping,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import {
  isToolbarLabelTriggerHighlighted,
  ToolbarLabelTriggerIcon,
  toolbarLabelTriggerTextStyle,
  toolbarLabelTriggerStyle,
} from "@/components/ui/toolbar-label-trigger";''', '''import {
  ToolbarLabelTriggerIcon,
  TOOLBAR_LABEL_TRIGGER_CLASS,
  TOOLBAR_LABEL_TRIGGER_TEXT,
} from "@/components/ui/toolbar-label-trigger";''')

# icons: plain lucide icons coloured by class
replace_between(pane, "type PressableStyleFn = (", "interface DiffLayoutToggleProps {", f'''const EXTRA_MUTED_ICON = "{EXTRA_MUTED}";
const noopStateChange = () => {{}};
const DIFF_OPTIONS_WHITESPACE_ICON = <Pilcrow size={{14}} className="text-muted-foreground" />;
const DIFF_OPTIONS_WRAP_ICON = <WrapText size={{14}} className="text-muted-foreground" />;
const DIFF_OPTIONS_SPLIT_ICON = <Columns2 size={{14}} className="text-muted-foreground" />;
const DIFF_OPTIONS_COLLAPSE_ICON = (
  <ListChevronsDownUp size={{14}} className="text-muted-foreground" />
);
const DIFF_OPTIONS_EXPAND_ICON = <ListChevronsUpDown size={{14}} className="text-muted-foreground" />;
const DIFF_OPTIONS_CHANGES_TAB_ICON = <Maximize size={{14}} className="text-muted-foreground" />;

/** The surface's own context menu is per file; the browser's is suppressed around it. */
function preventContextMenu(event: MouseEvent) {{
  event.preventDefault();
}}

''')

# DiffLayoutToggle: the toolbar's icon button
rep('''interface DiffLayoutToggleProps {
  layout: "unified" | "split";
  isMobile: boolean;
  testID?: string;
  toggleStyle?: PressableStyleFn;
  onToggle: () => void;
}''', '''interface DiffLayoutToggleProps {
  layout: "unified" | "split";
  isMobile: boolean;
  testID?: string;
  onToggle: () => void;
}''')
replace_between(pane, "export function DiffLayoutToggle({", "interface DiffModeMenuProps {", '''export function DiffLayoutToggle({
  layout,
  isMobile,
  testID = "changes-toggle-layout",
  onToggle,
}: DiffLayoutToggleProps) {
  const { t } = useTranslation();
  const label =
    layout === "unified"
      ? t("workspace.git.diff.switchToSplit")
      : t("workspace.git.diff.switchToUnified");
  const iconSize = isMobile ? 18 : 14;
  return (
    <ToolbarButton label={label} compact={isMobile} testID={testID} onPress={onToggle}>
      {layout === "unified" ? (
        <Columns2 size={iconSize} className="text-muted-foreground" />
      ) : (
        <AlignJustify size={iconSize} className="text-muted-foreground" />
      )}
    </ToolbarButton>
  );
}

''')

# DiffModeMenu trigger: a toolbar label button; Radix's data-state highlights it while open
rep('''      <DropdownMenuTrigger
        testID={`${testIDPrefix}-status-trigger`}
        style={toolbarLabelTriggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.diffMode")}
      >
        {(state) => {
          const highlighted = isToolbarLabelTriggerHighlighted(state);
          return (
            <>
              <ToolbarLabelTriggerIcon>
                <ThemedFileDiff size={13} uniProps={mutedIconColorMapping} />
              </ToolbarLabelTriggerIcon>
              <Text style={toolbarLabelTriggerTextStyle(highlighted)} numberOfLines={1}>
                {diffMode === "uncommitted" ? uncommittedLabel : committedLabel}
              </Text>
              <ToolbarLabelTriggerIcon>
                <ThemedChevronDown size={12} uniProps={extraMutedIconColorMapping} />
              </ToolbarLabelTriggerIcon>
            </>
          );
        }}
      </DropdownMenuTrigger>''', '''      <DropdownMenuTrigger
        testID={`${testIDPrefix}-status-trigger`}
        className={TOOLBAR_LABEL_TRIGGER_CLASS}
        accessibilityLabel={t("workspace.git.diff.diffMode")}
      >
        <ToolbarLabelTriggerIcon>
          <FileDiff size={13} className="text-muted-foreground" />
        </ToolbarLabelTriggerIcon>
        <span className={TOOLBAR_LABEL_TRIGGER_TEXT}>
          {diffMode === "uncommitted" ? uncommittedLabel : committedLabel}
        </span>
        <ToolbarLabelTriggerIcon>
          <ChevronDown size={12} className={EXTRA_MUTED_ICON} />
        </ToolbarLabelTriggerIcon>
      </DropdownMenuTrigger>''')

# header rows
rep('''  return (
    <View>
      <ChangesRepositoryToolbar
        compact={compact}
        model={repository}
        sidebarSurface={sidebarSurface}
      />
      <ChangesComparisonToolbar
        compact={compact}
        model={comparison}
        sidebarSurface={sidebarSurface}
      />
    </View>
  );''', '''  return (
    <div>
      <ChangesRepositoryToolbar
        compact={compact}
        model={repository}
        sidebarSurface={sidebarSurface}
      />
      <ChangesComparisonToolbar
        compact={compact}
        model={comparison}
        sidebarSurface={sidebarSurface}
      />
    </div>
  );''')
rep('''  const toolbarStyle = useMemo(
    () => [
      styles.changesToolbar,
      { paddingRight: paneContentToolbarTrailingPadding(compact) },
      sidebarSurface ? styles.changesToolbarSidebar : null,
    ],
    [compact, sidebarSurface],
  );
  return (
    <PaneContentToolbar style={toolbarStyle} testID={testID}>
      {children}
    </PaneContentToolbar>
  );''', '''  const toolbarStyle = useMemo(
    () => ({ paddingRight: paneContentToolbarTrailingPadding(compact) }),
    [compact],
  );
  return (
    <PaneContentToolbar
      className={cn("flex items-center gap-2 pl-2", sidebarSurface && "bg-sidebar")}
      style={toolbarStyle}
      testID={testID}
    >
      {children}
    </PaneContentToolbar>
  );''')
rep('''  return <View style={styles.changesToolbarIdentity}>{children}</View>;''',
    '''  return <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>;''')
rep('''  return <ToolbarControls style={styles.changesToolbarControls}>{children}</ToolbarControls>;''',
    '''  return (
    <ToolbarControls className="flex shrink-0 items-center justify-end">{children}</ToolbarControls>
  );''')

# pull request link: a toolbar label button
rep('''      <TooltipTrigger
        testID="changes-open-pull-request"
        accessibilityRole="button"
        accessibilityLabel={`${t("panels.pullRequest.label")} ${label}`}
        onPress={model.onOpen}
        style={toolbarLabelTriggerStyle}
      >
        {(state) => {
          const highlighted = isToolbarLabelTriggerHighlighted(state);
          return (
            <>
              <ToolbarLabelTriggerIcon>
                <PullRequestStateIcon state={model.state} size={14} strokeWidth={1.5} />
              </ToolbarLabelTriggerIcon>
              <Text style={toolbarLabelTriggerTextStyle(highlighted)}>{label}</Text>
            </>
          );
        }}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{t("panels.pullRequest.label")}</Text>
      </TooltipContent>''', '''      <TooltipTrigger
        testID="changes-open-pull-request"
        accessibilityLabel={`${t("panels.pullRequest.label")} ${label}`}
        onPress={model.onOpen}
        className={TOOLBAR_LABEL_TRIGGER_CLASS}
      >
        <ToolbarLabelTriggerIcon>
          <PullRequestStateIcon state={model.state} size={14} strokeWidth={1.5} />
        </ToolbarLabelTriggerIcon>
        <span className={TOOLBAR_LABEL_TRIGGER_TEXT}>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t("panels.pullRequest.label")}</TooltipContent>''')
rep('''      <ThemedExternalLink
        size={paneContentToolbarIconSize(compact)}
        strokeWidth={1.5}
        uniProps={extraMutedIconColorMapping}
      />''', '''      <ExternalLink
        size={paneContentToolbarIconSize(compact)}
        strokeWidth={1.5}
        className={EXTRA_MUTED_ICON}
      />''')

# toolbar icons
rep('''          {options.collapse.allFilesCollapsed ? (
            <ThemedListChevronsUpDown size={iconSize} uniProps={extraMutedIconColorMapping} />
          ) : (
            <ThemedListChevronsDownUp size={iconSize} uniProps={extraMutedIconColorMapping} />
          )}''', '''          {options.collapse.allFilesCollapsed ? (
            <ListChevronsUpDown size={iconSize} className={EXTRA_MUTED_ICON} />
          ) : (
            <ListChevronsDownUp size={iconSize} className={EXTRA_MUTED_ICON} />
          )}''')
rep('''          <ThemedColumns2 size={iconSize} uniProps={extraMutedIconColorMapping} />''',
    '''          <Columns2 size={iconSize} className={EXTRA_MUTED_ICON} />''')
rep('''        <ThemedPilcrow size={iconSize} uniProps={extraMutedIconColorMapping} />''',
    '''        <Pilcrow size={iconSize} className={EXTRA_MUTED_ICON} />''')
rep('''        <ThemedWrapText size={iconSize} uniProps={extraMutedIconColorMapping} />''',
    '''        <WrapText size={iconSize} className={EXTRA_MUTED_ICON} />''')
rep('''      {refresh.isRefreshing ? (
        <ThemedLoadingSpinner
          size={paneContentToolbarIconSize(compact)}
          uniProps={extraMutedIconColorMapping}
        />
      ) : (
        <ThemedRotateCw
          size={paneContentToolbarIconSize(compact)}
          uniProps={extraMutedIconColorMapping}
        />
      )}''', '''      {refresh.isRefreshing ? (
        <LoadingSpinner size={paneContentToolbarIconSize(compact)} className={EXTRA_MUTED_ICON} />
      ) : (
        <RotateCw size={paneContentToolbarIconSize(compact)} className={EXTRA_MUTED_ICON} />
      )}''')
rep('''        <ThemedMoreHorizontal
          size={paneContentToolbarIconSize(compact)}
          uniProps={extraMutedIconColorMapping}
        />''', '''        <MoreHorizontal size={paneContentToolbarIconSize(compact)} className={EXTRA_MUTED_ICON} />''')
rep('''const ThemedRotateCw = withUnistyles(RotateCw);

''', "")

# body states
CENTER = "flex flex-1 flex-col items-center justify-center pt-16"
rep('''    return (
      <View style={styles.loadingContainer}>
        <ThemedLoadingSpinner size="large" uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.loadingText}>{checkingRepositoryLabel}</Text>
      </View>
    );''', f'''    return (
      <div className="{CENTER} gap-4">
        <LoadingSpinner size="large" className="text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{{checkingRepositoryLabel}}</span>
      </div>
    );''')
rep('''    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{statusErrorMessage}</Text>
      </View>
    );''', f'''    return (
      <div className="{CENTER} px-6">
        <span className="text-center text-sm text-destructive">{{statusErrorMessage}}</span>
      </div>
    );''')
rep('''    return (
      <View style={styles.emptyContainer} testID="changes-not-git">
        <Text style={styles.emptyText}>{notRepositoryLabel}</Text>
      </View>
    );''', f'''    return (
      <div className="{CENTER} gap-2" data-testid="changes-not-git">
        <span className="text-sm text-muted-foreground">{{notRepositoryLabel}}</span>
      </div>
    );''')
rep('''    return (
      <View style={styles.loadingContainer}>
        <ThemedLoadingSpinner size="large" uniProps={foregroundMutedIconColorMapping} />
      </View>
    );''', f'''    return (
      <div className="{CENTER} gap-4">
        <LoadingSpinner size="large" className="text-muted-foreground" />
      </div>
    );''')
rep('''    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{diffErrorMessage}</Text>
      </View>
    );''', f'''    return (
      <div className="{CENTER} px-6">
        <span className="text-center text-sm text-destructive">{{diffErrorMessage}}</span>
      </div>
    );''')
rep('''      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>''', f'''      <div className="{CENTER} gap-2">
        <span className="text-sm text-muted-foreground">{{emptyMessage}}</span>''')
rep('''            {emptyAction.label}
          </Button>
        ) : null}
      </View>''', '''            {emptyAction.label}
          </Button>
        ) : null}
      </div>''')

rep('''function buildToggleButtonStyle(
  selected: boolean,
  baseStyles?: StyleProp<ViewStyle> | StyleProp<ViewStyle>[],
  isMobile = false,
): PressableStyleFn {
  return (state) => [baseStyles, paneContentToolbarIconButtonStyle(state, selected, isMobile)];
}

''', "")

# the Changes tree: every row, in a scrolling column (FlatList windowing is not ported)
rep('''  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      testID="changes-file-tree"
    />
  );''', '''  // shortcut: renders every changed file (the Expo FlatList windowed them); window it with
  // @tanstack/react-virtual if change sets of thousands of files get slow.
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="changes-file-tree">
      <div className="pb-8">
        {items.map((item) => (
          <Fragment key={keyExtractor(item)}>{renderItem({ item })}</Fragment>
        ))}
      </div>
    </div>
  );''')

# the surface
rep('''    <View
      {...{
        onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
      }}
      style={styles.container}
    >''', '''    <div className="flex min-h-0 flex-1 flex-col" onContextMenu={preventContextMenu}>''')
rep('''      {forgeSetupMessage ? (
        <View style={styles.forgeSetupCallout} testID="forge-setup-callout">
          <Text style={styles.forgeSetupCalloutText}>{forgeSetupMessage}</Text>
        </View>
      ) : null}

      {prErrorMessage ? <Text style={styles.actionErrorText}>{prErrorMessage}</Text> : null}

      <View style={styles.diffContainer}>{bodyContent}</View>''', '''      {forgeSetupMessage ? (
        <div
          className="mx-3 my-2 rounded-md border bg-card px-3 py-2"
          data-testid="forge-setup-callout"
        >
          <span className="text-xs text-muted-foreground">{forgeSetupMessage}</span>
        </div>
      ) : null}

      {prErrorMessage ? (
        <span className="px-3 pb-1 text-xs text-destructive">{prErrorMessage}</span>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">{bodyContent}</div>''')
rep('''        onCollapsedChange={handleCommitsCollapsedChange}
      />
    </View>
  );
}''', '''        onCollapsedChange={handleCommitsCollapsedChange}
      />
    </div>
  );
}''')
drop_styles(pane)
check_leftovers(pane, ["<View", "<Text", "<Pressable", "<FlatList", "styles.", "StyleSheet",
                       "withUnistyles", "Themed", "uniProps", "PressableStyleFn",
                       "toolbarLabelTriggerStyle", "react-native\""])
(OVR / "git/diff-pane.tsx").write_text(
    "// Override of packages/app/src/git/diff-pane.tsx: the Changes surface — branch and pull request\n"
    "// row, diff mode and toolbar, the changed-file tree, the diff document and the commits strip.\n"
    "// The logic is the Expo file's; the view is DOM.\n" + HEADER + pane["s"], encoding="utf-8")

# ---------------------------------------------------------------- panels/diff-panel.tsx
panel = {"name": "diff-panel", "s": (APP / "panels/diff-panel.tsx").read_text(encoding="utf-8")}
rep = make_rep(panel)
rep('import { Text, View } from "react-native";\n', "")
rep('import { FileDiff, GitCommitHorizontal } from "lucide-react-native";',
    'import { FileDiff, GitCommitHorizontal } from "lucide-react";')
rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n', "")
rep('''const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
''', "")
rep("  icon: ThemedFileDiff,", "  icon: FileDiff,", count=2)
rep("    icon: ThemedGitCommitHorizontal,", "    icon: GitCommitHorizontal,")
rep('''    <View style={styles.centerState} testID={testID}>
      <Text style={tone === "error" ? styles.errorText : styles.mutedText}>{message}</Text>
    </View>''', '''    <div className="flex flex-1 flex-col items-center justify-center px-6 pt-16" data-testid={testID}>
      <span
        className={
          tone === "error"
            ? "text-center text-sm text-destructive"
            : "text-center text-sm text-muted-foreground"
        }
      >
        {message}
      </span>
    </div>''')
rep('''    <View style={styles.container} testID={testID}>
      <RenderProfile id={profileId}>''', '''    <div className="flex min-h-0 flex-1 flex-col" data-testid={testID}>
      <RenderProfile id={profileId}>''')
rep('''      </RenderProfile>
    </View>
  );''', '''      </RenderProfile>
    </div>
  );''')
rep('''    <View style={styles.container} testID="commit-diff-panel">
      {panelPreferences.canUseSplitLayout ? (
        <PaneContentToolbar style={styles.toolbar} testID="commit-diff-header">
          <View style={styles.toolbarActions} testID="commit-diff-toolbar">''', '''    <div className="flex min-h-0 flex-1 flex-col" data-testid="commit-diff-panel">
      {panelPreferences.canUseSplitLayout ? (
        <PaneContentToolbar
          className="flex items-center justify-between gap-2 pr-2"
          testID="commit-diff-header"
        >
          <div
            className="flex flex-1 items-center justify-end gap-1"
            data-testid="commit-diff-toolbar"
          >''')
rep('''              onToggle={panelPreferences.toggleLayout}
            />
          </View>
        </PaneContentToolbar>
      ) : null}
      <View style={styles.body}>{body}</View>
    </View>''', '''              onToggle={panelPreferences.toggleLayout}
            />
          </div>
        </PaneContentToolbar>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>''')
drop_styles(panel)
check_leftovers(panel, ["<View", "<Text", "styles.", "StyleSheet", "withUnistyles", "Themed"])
(OVR / "panels/diff-panel.tsx").write_text(
    "// Override of packages/app/src/panels/diff-panel.tsx: the Changes and Diff tabs and a commit's\n"
    "// diff. Same descriptors and logic; the view is DOM.\n" + HEADER + panel["s"],
    encoding="utf-8")
print("ok")
