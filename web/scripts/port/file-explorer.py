#!/usr/bin/env python3
"""Port packages/app's file tree (files panel and FileExplorerPane) to web/src/overrides."""
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


def check_leftovers(state, needles):
    for needle in needles:
        if needle in state["s"]:
            i = state["s"].index(needle)
            raise SystemExit(f"{state['name']}: leftover {needle}: {state['s'][i - 300:i + 200]}")


HEADER = """// Generated from the Expo file by web/scripts/port/file-explorer.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
"""

# ---------------------------------------------------------------- panels/files-panel.tsx
panel = {"name": "files-panel", "s": (APP / "panels/files-panel.tsx").read_text(encoding="utf-8")}
rep = make_rep(panel)
rep('''import { Text, View } from "react-native";
import { Files } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
''', 'import { Files } from "lucide-react";\n')
rep('''const ThemedFiles = withUnistyles(Files);
''', "")
rep("  icon: ThemedFiles,", "  icon: Files,")
rep('''      <View style={styles.centerState}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>''', '''      <div className="flex flex-1 items-center justify-center p-4">
        <span>{t("panels.file.directoryMissing")}</span>
      </div>''')
start = panel["s"].index("const styles = StyleSheet.create((theme) => ({")
panel["s"] = panel["s"][:start].rstrip() + "\n"
check_leftovers(panel, ["<View", "<Text", "react-native", "styles."])
(OVR / "panels/files-panel.tsx").write_text(
    "// Override of packages/app/src/panels/files-panel.tsx: same panel, DOM view.\n" + HEADER
    + panel["s"], encoding="utf-8")

# ---------------------------------------------------------------- components/file-explorer-pane.tsx
pane = {"name": "file-explorer-pane",
        "s": (APP / "components/file-explorer-pane.tsx").read_text(encoding="utf-8")}
rep = make_rep(pane)

# imports
rep('''  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";''', '''  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefCallback,
  type RefObject,
} from "react";''')
rep('''import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  Text,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
''', '''import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";
import { DomOverlayScrollbar } from "@/components/ui/overlay-scrollbar/dom-overlay-scrollbar";
import { focusWithRetries } from "@/utils/web-focus";
''')
rep('import { ChevronDown, Eye, EyeOff, FilePlus, FolderPlus, RotateCw } from "lucide-react-native";',
    'import { ChevronDown, Eye, EyeOff, FilePlus, FolderPlus, RotateCw } from "lucide-react";')
rep('''import {
  TreeChevron,
  treeRowPaddingLeft,
  workspaceTreeRowStyles,
  WORKSPACE_TREE_ICON_LABEL_GAP,
  WORKSPACE_TREE_ICON_SIZE,
  WORKSPACE_TREE_LOADING_ICON_SIZE,
} from "@/components/tree-primitives";
import { LoadingSpinner } from "@/components/ui/loading-spinner";''', '''import {
  TreeChevron,
  treeRowPaddingLeft,
  workspaceTreeRowClassNames,
  WORKSPACE_TREE_ICON_SIZE,
} from "@/components/tree-primitives";''')
rep('''import {
  useOverlayFlatListScrollbar,
  type OverlayFlatListScrollbar,
} from "@/components/ui/overlay-scrollbar/use-overlay-flat-list-scrollbar";
import type { Theme } from "@/styles/theme";
''', "")
rep('import { ContextMenu, ContextMenuTrigger, useContextMenu } from "@/components/ui/context-menu";',
    'import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";')
# The .web hook attaches the drag source; name it so the typecheck reads the same file as Vite.
rep('import { useWorkspaceFileDragSource } from "@/attachments/use-workspace-file-drag-source";',
    'import { useWorkspaceFileDragSource } from "@/attachments/use-workspace-file-drag-source.web";')

rep('''const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function DirectoryChevronIcon({ loading, expanded }: { loading: boolean; expanded: boolean }) {
  if (loading) {
    return (
      <ThemedLoadingSpinner
        size={WORKSPACE_TREE_LOADING_ICON_SIZE}
        uniProps={foregroundMutedColorMapping}
      />
    );
  }
  return <TreeChevron expanded={expanded} />;
}''', '''const CENTER_STATE = "flex flex-1 flex-col items-center justify-center gap-2 p-4";
const ERROR_BUTTON =
  "rounded-md border px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-accent";
// The tree draws its own overlay thumb on desktop, so the native bar is hidden there.
const HIDE_NATIVE_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/**
 * A FlatList render callback's argument.
 * shortcut: the tree renders every row (the Expo FlatList windowed them); window it with
 * @tanstack/react-virtual if huge directories get slow.
 */
interface ListRenderItemInfo<T> {
  item: T;
  index: number;
}

function preventContextMenu(event: { preventDefault(): void }) {
  event.preventDefault();
}

function noop() {}

function rowPaddingStyle(depth: number): CSSProperties {
  return { paddingLeft: treeRowPaddingLeft(depth) };
}

function DirectoryChevronIcon({ loading, expanded }: { loading: boolean; expanded: boolean }) {
  if (loading) {
    return <Spinner className="size-3.5 text-muted-foreground" />;
  }
  return <TreeChevron expanded={expanded} />;
}''')
rep('''function sortTriggerStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.sortTrigger, (Boolean(hovered) || pressed) && styles.sortTriggerHovered];
}

''', "")

# ------------------------------------------------ EntryNameInputRow
rep('''  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Escape") {
        settledRef.current = true;
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <View style={[workspaceTreeRowStyles.row, { paddingLeft: treeRowPaddingLeft(depth) }]}>
      <View style={styles.entryInfo}>
        <View style={styles.entryIcon}>
          {kind === "directory" ? (
            <TreeChevron expanded={false} />
          ) : (
            <MaterialFileIcon fileName={name || "untitled"} size={WORKSPACE_TREE_ICON_SIZE} />
          )}
        </View>
        <TextInput
          autoFocus
          initialValue={name}
          onChangeText={setName}
          onSubmitEditing={commit}
          onBlur={commit}
          onKeyPress={handleKeyPress}
          placeholder={
            kind === "directory"
              ? t("workspace.fileExplorer.draft.folderPlaceholder")
              : t("workspace.fileExplorer.draft.filePlaceholder")
          }
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={styles.draftPlaceholder.color}
          style={styles.draftInput}
          selectTextOnFocus={Boolean(initialName)}
          testID="file-explorer-name-input"
        />
      </View>
    </View>
  );''', '''  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        settledRef.current = true;
        onCancel();
        return;
      }
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        commit();
      }
    },
    [commit, onCancel],
  );
  const handleChange = useCallback(
    (event: { target: HTMLInputElement }) => setName(event.target.value),
    [],
  );
  // A menu item starts this edit, and a closing Radix menu holds focus and then hands it back to
  // its trigger; keep asking until the field has it.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      focusWithRetries({
        focus: () => inputRef.current?.focus(),
        isFocused: () => document.activeElement === inputRef.current,
      }),
    [],
  );
  const handleBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      // Focus pulled into that closing menu is not the user leaving the field.
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="menu"]')) {
        return;
      }
      commit();
    },
    [commit],
  );
  // Renaming selects the current name, as the native field's selectTextOnFocus did.
  const handleFocus = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      if (initialName) event.currentTarget.select();
    },
    [initialName],
  );
  const rowStyle = useMemo(() => rowPaddingStyle(depth), [depth]);

  return (
    <div className={workspaceTreeRowClassNames.row} style={rowStyle}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {kind === "directory" ? (
            <TreeChevron expanded={false} />
          ) : (
            <MaterialFileIcon fileName={name || "untitled"} size={WORKSPACE_TREE_ICON_SIZE} />
          )}
        </span>
        <input
          ref={inputRef}
          value={name}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={
            kind === "directory"
              ? t("workspace.fileExplorer.draft.folderPlaceholder")
              : t("workspace.fileExplorer.draft.filePlaceholder")
          }
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-testid="file-explorer-name-input"
          className="min-w-0 flex-1 bg-transparent p-0 text-sm leading-[18px] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
      </div>
    </div>
  );''')

# ------------------------------------------------ TreeRowItem
rep('''  const [isHovered, setIsHovered] = useState(false);
  const showNameHover = useCallback(() => setIsHovered(true), []);
  const hideNameHover = useCallback(() => setIsHovered(false), []);
  const isDirectory = entry.kind === "directory";''', '''  const isDirectory = entry.kind === "directory";''')
rep('''  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      workspaceTreeRowStyles.row,
      { paddingLeft: treeRowPaddingLeft(depth) },
      (Boolean(hovered) || pressed || isSelected) && workspaceTreeRowStyles.active,
    ],
    [depth, isSelected],
  );''', '''  const rowStyle = useMemo(() => rowPaddingStyle(depth), [depth]);''')
rep('''      <ContextMenuTrigger
        onPress={handlePress}
        onLongPress={handleSelect}
        onContextMenu={handleSelect}
        style={pressableStyle}
        onHoverIn={showNameHover}
        onHoverOut={hideNameHover}
        accessibilityState={accessibilityState}
        aria-selected={isSelected}
        testID={testID}
      >
        <View ref={dragSourceRef} style={styles.entryInfo}>
          <View style={styles.entryIcon}>
            {isDirectory ? (
              <DirectoryChevronIcon loading={loading} expanded={isExpanded} />
            ) : (
              <MaterialFileIcon fileName={entry.name} size={WORKSPACE_TREE_ICON_SIZE} />
            )}
          </View>
          <Text
            style={[
              styles.entryName,
              workspaceTreeRowStyles.name,
              isHovered && workspaceTreeRowStyles.nameHovered,
            ]}
            numberOfLines={1}
            testID={testID ? `${testID}-name` : undefined}
          >
            {entry.name}
          </Text>
        </View>
      </ContextMenuTrigger>''', '''      <ContextMenuTrigger
        onPress={handlePress}
        onLongPress={handleSelect}
        onContextMenu={handleSelect}
        style={rowStyle}
        className={cn(
          workspaceTreeRowClassNames.row,
          workspaceTreeRowClassNames.hoverable,
          "cursor-pointer outline-none focus-visible:bg-sidebar-accent",
          isSelected && workspaceTreeRowClassNames.active,
        )}
        aria-selected={isSelected}
        testID={testID}
      >
        <div
          ref={dragSourceRef as RefCallback<HTMLDivElement>}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {isDirectory ? (
              <DirectoryChevronIcon loading={loading} expanded={isExpanded} />
            ) : (
              <MaterialFileIcon fileName={entry.name} size={WORKSPACE_TREE_ICON_SIZE} />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm leading-[18px] select-none",
              workspaceTreeRowClassNames.name,
            )}
            data-testid={testID ? `${testID}-name` : undefined}
          >
            {entry.name}
          </span>
        </div>
      </ContextMenuTrigger>''')

# ------------------------------------------------ FileExplorerPane
rep('''  const treeListRef = useRef<FlatList<ExplorerListRow>>(null);
  const scrollbar = useOverlayFlatListScrollbar(treeListRef, { enabled: !isCompact });
''', '''  const treeListRef = useRef<HTMLDivElement>(null);
''')
rep('''      <View style={styles.centerState}>
        <Text style={styles.errorText}>{t("workspace.fileExplorer.states.unavailable")}</Text>
      </View>''', '''      <div className={CENTER_STATE}>
        <span className="text-center text-sm text-destructive">
          {t("workspace.fileExplorer.states.unavailable")}
        </span>
      </div>''')
rep('''    <View
      {...{
        onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
      }}
      style={styles.container}
    >''', '''    <div onContextMenu={preventContextMenu} className="flex min-h-0 flex-1 flex-col">''')
rep('''        treeListRef={treeListRef}
        scrollbar={scrollbar}
        renderTreeRow={renderTreeRow}''', '''        treeListRef={treeListRef}
        renderTreeRow={renderTreeRow}''')
rep('''        handleRetry={handleRetry}
        sortTriggerStyle={sortTriggerStyle}
      />
    </View>''', '''        handleRetry={handleRetry}
      />
    </div>''')

# ------------------------------------------------ the root context target and the pane content
replace_between(pane, "interface WebContextMenuEvent {", "function deriveExplorerFields(", '''interface FileExplorerPaneContentProps {
  error: string | null;
  isCompact: boolean;
  showInitialLoading: boolean;
  showBackFromError: boolean;
  listRows: ExplorerListRow[];
  onNewEntryAtRoot?: (parentPath: string, kind: "file" | "directory") => void;
  currentSortLabel: string;
  isRefreshFetching: boolean;
  treeListRef: RefObject<HTMLDivElement | null>;
  renderTreeRow: (info: ListRenderItemInfo<ExplorerListRow>) => ReactElement;
  handleSortCycle: () => void;
  handleToggleHiddenFiles: () => void;
  handleRefresh: () => void;
  handleBackFromError: () => void;
  handleRetry: () => void;
}

function FileExplorerPaneContent(props: FileExplorerPaneContentProps) {
  const { t } = useTranslation();
  const {
    error,
    isCompact,
    showInitialLoading,
    showBackFromError,
    listRows,
    onNewEntryAtRoot,
    currentSortLabel,
    isRefreshFetching,
    treeListRef,
    renderTreeRow,
    handleSortCycle,
    handleToggleHiddenFiles,
    handleRefresh,
    handleBackFromError,
    handleRetry,
  } = props;

  const showHiddenFiles = usePanelStore((state) => state.explorerShowHiddenFiles);

  const handleNewFileAtRoot = useCallback(() => {
    onNewEntryAtRoot?.(".", "file");
  }, [onNewEntryAtRoot]);
  const handleNewFolderAtRoot = useCallback(() => {
    onNewEntryAtRoot?.(".", "directory");
  }, [onNewEntryAtRoot]);
  const headerStyle = useMemo(
    () => ({ paddingRight: paneContentToolbarTrailingPadding(isCompact) }),
    [isCompact],
  );

  const hiddenFilesToggleAccessibilityLabel = showHiddenFiles
    ? t("workspace.fileExplorer.actions.hideHiddenFiles")
    : t("workspace.fileExplorer.actions.showHiddenFiles");
  const emptyLabel = showHiddenFiles
    ? t("workspace.fileExplorer.empty.noFiles")
    : t("workspace.fileExplorer.empty.noVisibleFiles");

  if (error) {
    return (
      <div className={CENTER_STATE}>
        <span className="text-center text-sm text-destructive">{error}</span>
        <div className="flex items-center gap-2">
          {showBackFromError ? (
            <button type="button" className={ERROR_BUTTON} onClick={handleBackFromError}>
              {t("workspace.fileExplorer.actions.back")}
            </button>
          ) : null}
          <button type="button" className={ERROR_BUTTON} onClick={handleRetry}>
            {t("workspace.fileExplorer.actions.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (showInitialLoading) {
    return (
      <div className={CENTER_STATE}>
        <Spinner className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {t("workspace.fileExplorer.states.loading")}
        </span>
      </div>
    );
  }

  const iconSize = paneContentToolbarIconSize(isCompact);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneContentToolbar
        className="flex items-center justify-between bg-sidebar"
        style={headerStyle}
        testID="files-pane-header"
      >
        <button
          type="button"
          onClick={handleSortCycle}
          data-testid="files-sort-trigger"
          className="ml-2 flex h-6 items-center justify-center gap-1 rounded-md px-1 text-xs text-muted-foreground hover:bg-sidebar-accent"
        >
          <span data-testid="files-sort-label">{currentSortLabel}</span>
          <ChevronDown size={12} />
        </button>
        <ToolbarControls>
          {onNewEntryAtRoot ? (
            <>
              <ToolbarButton
                label={t("workspace.fileActions.newFile")}
                compact={isCompact}
                testID="files-new-file"
                onPress={handleNewFileAtRoot}
              >
                <FilePlus size={iconSize} className="text-muted-foreground/70" />
              </ToolbarButton>
              <ToolbarButton
                label={t("workspace.fileActions.newFolder")}
                compact={isCompact}
                testID="files-new-folder"
                onPress={handleNewFolderAtRoot}
              >
                <FolderPlus size={iconSize} className="text-muted-foreground/70" />
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton
            label={hiddenFilesToggleAccessibilityLabel}
            selected={!showHiddenFiles}
            compact={isCompact}
            testID="files-hidden-toggle"
            onPress={handleToggleHiddenFiles}
          >
            {showHiddenFiles ? (
              <Eye size={iconSize} className="text-muted-foreground/70" />
            ) : (
              <EyeOff size={iconSize} className="text-muted-foreground/70" />
            )}
          </ToolbarButton>
          <ToolbarButton
            label={
              isRefreshFetching
                ? t("workspace.fileExplorer.actions.refreshing")
                : t("workspace.fileExplorer.actions.refresh")
            }
            compact={isCompact}
            disabled={isRefreshFetching}
            testID="files-refresh"
            onPress={handleRefresh}
          >
            <span className="flex size-4 items-center justify-center">
              {isRefreshFetching ? (
                <Spinner className="size-3.5 text-muted-foreground/70" />
              ) : (
                <RotateCw size={iconSize} className="text-muted-foreground/70" />
              )}
            </span>
          </ToolbarButton>
        </ToolbarControls>
      </PaneContentToolbar>
      <ContextMenu>
        {/* Right-clicking a row opens the row's menu; the empty area opens New file / folder. */}
        <ContextMenuTrigger
          contextOnly
          enabled={Boolean(onNewEntryAtRoot)}
          testID="files-empty-area"
          className="relative flex min-h-0 flex-1 flex-col"
        >
          {listRows.length === 0 ? (
            <div className={CENTER_STATE}>
              <span className="text-center text-sm text-muted-foreground">{emptyLabel}</span>
            </div>
          ) : (
            <>
              <div
                ref={treeListRef}
                data-testid="file-explorer-tree-scroll"
                className={cn("min-h-0 flex-1 overflow-y-auto", !isCompact && HIDE_NATIVE_SCROLLBAR)}
              >
                <div className="flex min-h-full flex-col pt-2 pb-4">
                  {listRows.map((row, index) => (
                    <Fragment key={listRowKeyExtractor(row)}>
                      {renderTreeRow({ item: row, index })}
                    </Fragment>
                  ))}
                </div>
              </div>
              {isCompact ? null : (
                <DomOverlayScrollbar scrollContainerRef={treeListRef} onUserScrollUp={noop} />
              )}
            </>
          )}
        </ContextMenuTrigger>
        {onNewEntryAtRoot ? (
          <FileActionsContextMenuContent
            fileKind="directory"
            onNewFile={handleNewFileAtRoot}
            onNewFolder={handleNewFolderAtRoot}
            testIDPrefix="files-empty-area"
          />
        ) : null}
      </ContextMenu>
    </div>
  );
}

''')
rep('''import {
  useCallback,
  useEffect,''', '''import {
  Fragment,
  useCallback,
  useEffect,''')
start = pane["s"].index("const styles = StyleSheet.create((theme) => ({")
pane["s"] = pane["s"][:start].rstrip() + "\n"
check_leftovers(pane, ["<View", "<Text", "<Pressable", "<FlatList", "styles.", "StyleSheet",
                       "withUnistyles", "useUnistyles", "scrollbar.", "LoadingSpinner",
                       "workspaceTreeRowStyles", "useContextMenu", "isHovered"])
(OVR / "components/file-explorer-pane.tsx").write_text(
    "// Override of packages/app/src/components/file-explorer-pane.tsx. The tree logic is the Expo\n"
    "// file's (listing, expand and restore, sort, hidden files, refresh, create, rename, duplicate,\n"
    "// delete, copy path, download, add to chat, drag into the composer); the view is DOM.\n"
    + HEADER + pane["s"], encoding="utf-8")
print("ok")
