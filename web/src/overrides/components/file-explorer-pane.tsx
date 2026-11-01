// Override of packages/app/src/components/file-explorer-pane.tsx. The tree logic is the Expo
// file's (listing, expand and restore, sort, hidden files, refresh, create, rename, duplicate,
// delete, copy path, download, add to chat, drag into the composer); the view is DOM.
// Generated from the Expo file by web/scripts/port/file-explorer.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefCallback,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";
import { DomOverlayScrollbar } from "@/components/ui/overlay-scrollbar/dom-overlay-scrollbar";
import { focusWithRetries } from "@/utils/web-focus";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import * as Clipboard from "expo-clipboard";
import { ChevronDown, Eye, EyeOff, FilePlus, FolderPlus, RotateCw } from "lucide-react";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  TreeChevron,
  treeRowPaddingLeft,
  workspaceTreeRowClassNames,
  WORKSPACE_TREE_ICON_SIZE,
} from "@/components/tree-primitives";
import {
  PaneContentToolbar,
  paneContentToolbarIconSize,
  paneContentToolbarTrailingPadding,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import type {
  AgentFileExplorerState,
  ExplorerDirectory,
  ExplorerEntry,
} from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useFileDownload } from "@/hooks/use-file-download";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";
import { usePanelStore, type ExpandedPathsUpdate, type SortOption } from "@/stores/panel-store";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { isHiddenExplorerPath } from "@/file-explorer/visibility";
import {
  flattenExplorerTree,
  reconcileRestoredExpandedPaths,
  restoreExpandedDirectories,
  setExpandedDirectoryPath,
  showHiddenFilesAndRestoreExpandedDirectories,
  type ExplorerTreeRow,
} from "@/file-explorer/tree";
import { useWorkspaceFileDragSource } from "@/attachments/use-workspace-file-drag-source.web";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useToast } from "@/contexts/toast-context";

const SORT_OPTIONS: { value: SortOption }[] = [
  { value: "name" },
  { value: "modified" },
  { value: "size" },
];

const CENTER_STATE = "flex flex-1 flex-col items-center justify-center gap-2 p-4";
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
}

interface TreeRowItemProps {
  serverId: string;
  workspaceId?: string | null;
  entry: ExplorerEntry;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  loading: boolean;
  onEntryPress: (entry: ExplorerEntry) => void;
  onSelectEntry: (entry: ExplorerEntry) => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onAddToChat?: (path: string) => void;
  onOpenFileToSide?: (path: string) => void;
  onNewEntry?: (parentPath: string, kind: "file" | "directory") => void;
  onCollapseDirectory?: (path: string) => void;
  onRenameEntry?: (entry: ExplorerEntry) => void;
  onDuplicateEntry?: (entry: ExplorerEntry) => void;
  onDeleteEntry?: (entry: ExplorerEntry) => void;
  testID?: string;
}

type ExplorerListRow =
  | { type: "entry"; row: ExplorerTreeRow }
  | { type: "draft"; parentPath: string; kind: "file" | "directory"; depth: number }
  | { type: "rename"; entry: ExplorerEntry; depth: number };

type ExplorerPendingEdit =
  | { type: "create"; parentPath: string; kind: "file" | "directory" }
  | { type: "rename"; entry: ExplorerEntry };

function listRowKeyExtractor(row: ExplorerListRow) {
  if (row.type === "entry") {
    return row.row.entry.path;
  }
  return row.type === "rename" ? `rename:${row.entry.path}` : `draft:${row.parentPath}:${row.kind}`;
}

interface EntryNameInputRowProps {
  depth: number;
  kind: "file" | "directory";
  initialName?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

function EntryNameInputRow({
  depth,
  kind,
  initialName = "",
  onCommit,
  onCancel,
}: EntryNameInputRowProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const settledRef = useRef(false);

  const commit = useCallback(() => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    const trimmed = name.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  }, [name, onCancel, onCommit]);

  const handleKeyDown = useCallback(
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
          className="min-w-0 flex-1 bg-transparent p-0 text-sm leading-[18px] text-foreground outline-none placeholder:text-extra-muted-foreground"
        />
      </div>
    </div>
  );
}

function TreeRowItem({
  serverId,
  workspaceId,
  entry,
  depth,
  isExpanded,
  isSelected,
  loading,
  onEntryPress,
  onSelectEntry,
  onCopyPath,
  onCopyRelativePath,
  onDownloadEntry,
  onAddToChat,
  onOpenFileToSide,
  onNewEntry,
  onCollapseDirectory,
  onRenameEntry,
  onDuplicateEntry,
  onDeleteEntry,
  testID,
}: TreeRowItemProps) {
  const isDirectory = entry.kind === "directory";
  const dragSourceRef = useWorkspaceFileDragSource({
    enabled: !isDirectory,
    serverId,
    workspaceId,
    path: entry.path,
  });

  const handlePress = useCallback(() => {
    const selection = isWeb ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return;
    }
    onEntryPress(entry);
  }, [onEntryPress, entry]);

  const handleSelect = useCallback(() => {
    onSelectEntry(entry);
  }, [entry, onSelectEntry]);
  const rowStyle = useMemo(() => rowPaddingStyle(depth), [depth]);

  const handleCopy = useCallback(() => {
    onCopyPath(entry.path);
  }, [onCopyPath, entry.path]);

  const handleCopyRelativePath = useCallback(() => {
    onCopyRelativePath(entry.path);
  }, [onCopyRelativePath, entry.path]);

  const handleDownload = useCallback(() => {
    onDownloadEntry(entry);
  }, [onDownloadEntry, entry]);

  const handleAddToChat = useCallback(() => {
    onAddToChat?.(entry.path);
  }, [onAddToChat, entry.path]);

  const handleOpenToSide = useCallback(() => {
    onOpenFileToSide?.(entry.path);
  }, [entry.path, onOpenFileToSide]);

  const handleNewFile = useCallback(() => {
    onNewEntry?.(entry.path, "file");
  }, [onNewEntry, entry.path]);

  const handleNewFolder = useCallback(() => {
    onNewEntry?.(entry.path, "directory");
  }, [onNewEntry, entry.path]);

  const handleCollapseDirectory = useCallback(() => {
    onCollapseDirectory?.(entry.path);
  }, [entry.path, onCollapseDirectory]);

  const handleRename = useCallback(() => {
    onRenameEntry?.(entry);
  }, [onRenameEntry, entry]);

  const handleDuplicate = useCallback(() => {
    onDuplicateEntry?.(entry);
  }, [entry, onDuplicateEntry]);

  const handleDelete = useCallback(() => {
    onDeleteEntry?.(entry);
  }, [onDeleteEntry, entry]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
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
      </ContextMenuTrigger>
      <FileActionsContextMenuContent
        fileKind={entry.kind}
        onCopyPath={handleCopy}
        onCopyRelativePath={handleCopyRelativePath}
        onDownload={handleDownload}
        onAddToChat={onAddToChat ? handleAddToChat : undefined}
        onOpenToSide={!isDirectory && onOpenFileToSide ? handleOpenToSide : undefined}
        onNewFile={onNewEntry ? handleNewFile : undefined}
        onNewFolder={onNewEntry ? handleNewFolder : undefined}
        onCollapseFolder={isDirectory && isExpanded ? handleCollapseDirectory : undefined}
        onRename={onRenameEntry ? handleRename : undefined}
        onDuplicate={onDuplicateEntry ? handleDuplicate : undefined}
        onDelete={onDeleteEntry ? handleDelete : undefined}
        testIDPrefix={testID}
      />
    </ContextMenu>
  );
}

interface FileExplorerPaneProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  onOpenFile?: (filePath: string) => void;
  onOpenFileToSide?: (filePath: string) => void;
  onAddToChat?: (path: string) => void;
}

export function FileExplorerPane({
  serverId,
  workspaceId,
  workspaceRoot,
  onOpenFile,
  onOpenFileToSide,
  onAddToChat,
}: FileExplorerPaneProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();

  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const workspaceStateKey = useMemo(
    () =>
      buildWorkspaceExplorerStateKey({
        workspaceId,
        workspaceRoot: normalizedWorkspaceRoot,
      }),
    [normalizedWorkspaceRoot, workspaceId],
  );
  const hasWorkspaceScope = Boolean(workspaceStateKey && normalizedWorkspaceRoot);
  const explorerState = useSessionStore((state) =>
    workspaceStateKey && state.sessions[serverId]
      ? state.sessions[serverId]?.fileExplorer.get(workspaceStateKey)
      : undefined,
  );

  const {
    requestDirectoryListing,
    createEntry,
    renameEntry,
    duplicateEntry,
    deleteEntry,
    selectExplorerEntry,
  } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
  });
  const toast = useToast();
  // COMPAT(fsEntryOps): added in v0.3.0, remove gate after 2027-02-08.
  const fsEntryOpsEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fsEntryOps === true,
  );
  // COMPAT(fsEntryDuplicate): added in v0.3.0, remove gate after 2027-02-09.
  const fsEntryDuplicateEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fsEntryDuplicate === true,
  );
  const [pendingEdit, setPendingEdit] = useState<ExplorerPendingEdit | null>(null);
  const downloadFile = useFileDownload({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
  });
  const sortOption = usePanelStore((state) => state.explorerSortOption);
  const showHiddenFiles = usePanelStore((state) => state.explorerShowHiddenFiles);
  const setSortOption = usePanelStore((state) => state.setExplorerSortOption);
  const toggleExplorerShowHiddenFiles = usePanelStore(
    (state) => state.toggleExplorerShowHiddenFiles,
  );
  const expandedPathsArray = usePanelStore((state) =>
    workspaceStateKey ? state.expandedPathsByWorkspace[workspaceStateKey] : undefined,
  );
  const setExpandedPathsForWorkspace = usePanelStore((state) => state.setExpandedPathsForWorkspace);
  const expandedPaths = useMemo(
    () => new Set(expandedPathsArray && expandedPathsArray.length > 0 ? expandedPathsArray : ["."]),
    [expandedPathsArray],
  );

  const explorerDerived = useMemo(() => deriveExplorerFields(explorerState), [explorerState]);
  const { directories, pendingRequest, isExplorerLoading, error, selectedEntryPath } =
    explorerDerived;

  const isDirectoryLoading = useCallback(
    (path: string) => isPendingListForPath({ isExplorerLoading, pendingRequest, path }),
    [isExplorerLoading, pendingRequest],
  );

  const treeListRef = useRef<HTMLDivElement>(null);

  const hasInitializedRef = useRef(false);

  useEffect(() => {
    hasInitializedRef.current = false;
  }, [workspaceStateKey]);

  useEffect(() => {
    void initializeExplorer({
      hasWorkspaceScope,
      hasInitializedRef,
      workspaceStateKey,
      persistedExpandedPaths: expandedPaths,
      showHiddenFiles,
      requestDirectoryListing,
      setExpandedPathsForWorkspace,
    });
  }, [
    expandedPaths,
    hasWorkspaceScope,
    requestDirectoryListing,
    setExpandedPathsForWorkspace,
    showHiddenFiles,
    workspaceStateKey,
  ]);

  const handleToggleDirectory = useCallback(
    (entry: ExplorerEntry) =>
      toggleDirectory({
        entry,
        workspaceStateKey,
        expandedPaths,
        directories,
        requestDirectoryListing,
        setExpandedPathsForWorkspace,
      }),
    [
      workspaceStateKey,
      expandedPaths,
      directories,
      requestDirectoryListing,
      setExpandedPathsForWorkspace,
    ],
  );

  // Selection is intentionally separate from opening/expansion so future keyboard actions
  // (for example, pressing R to rename) have one stable file-or-folder target.
  const handleSelectEntry = useCallback(
    (entry: ExplorerEntry) => {
      if (hasWorkspaceScope) {
        selectExplorerEntry(entry.path);
      }
    },
    [hasWorkspaceScope, selectExplorerEntry],
  );

  const handleOpenFile = useCallback(
    (entry: ExplorerEntry) => {
      if (!hasWorkspaceScope) {
        return;
      }
      onOpenFile?.(entry.path);
    },
    [hasWorkspaceScope, onOpenFile],
  );

  const handleEntryPress = useCallback(
    (entry: ExplorerEntry) => {
      handleSelectEntry(entry);
      if (entry.kind === "directory") {
        handleToggleDirectory(entry);
        return;
      }
      handleOpenFile(entry);
    },
    [handleOpenFile, handleSelectEntry, handleToggleDirectory],
  );

  const handleCollapseDirectory = useCallback(
    (path: string) => {
      if (!workspaceStateKey) {
        return;
      }
      setExpandedPathsForWorkspace(workspaceStateKey, (currentPaths) =>
        currentPaths.filter((expandedPath) => !isExplorerPathWithin(expandedPath, path)),
      );
    },
    [setExpandedPathsForWorkspace, workspaceStateKey],
  );

  const handleCopyPath = useCallback(
    async (path: string) => {
      await Clipboard.setStringAsync(
        buildAbsoluteExplorerPath({
          workspaceRoot: normalizedWorkspaceRoot,
          entryPath: path,
        }),
      );
    },
    [normalizedWorkspaceRoot],
  );

  const handleCopyRelativePath = useCallback(async (path: string) => {
    await Clipboard.setStringAsync(path);
  }, []);

  const handleDownloadEntry = useCallback(
    (entry: ExplorerEntry) => {
      if (entry.kind !== "file") {
        return;
      }
      downloadFile({ fileName: entry.name, path: entry.path });
    },
    [downloadFile],
  );

  const handleNewEntry = useCallback(
    (parentPath: string, kind: "file" | "directory") => {
      if (!workspaceStateKey) {
        return;
      }
      if (parentPath !== ".") {
        setExpandedPathsForWorkspace(workspaceStateKey, (currentPaths) =>
          setExpandedDirectoryPath({
            currentExpandedPaths: currentPaths,
            directoryPath: parentPath,
            expanded: true,
          }),
        );
        if (!directories.has(parentPath)) {
          void requestDirectoryListing(parentPath, {
            recordHistory: false,
            setCurrentPath: false,
          });
        }
      }
      setPendingEdit({ type: "create", parentPath, kind });
    },
    [directories, requestDirectoryListing, setExpandedPathsForWorkspace, workspaceStateKey],
  );

  const handleEditCancel = useCallback(() => {
    setPendingEdit(null);
  }, []);

  const handleRenameEntry = useCallback((entry: ExplorerEntry) => {
    setPendingEdit({ type: "rename", entry });
  }, []);

  const handleDraftCommit = useCallback(
    async (name: string) => {
      const edit = pendingEdit;
      setPendingEdit(null);
      if (edit?.type !== "create") {
        return;
      }
      try {
        const payload = await createEntry({
          parentPath: edit.parentPath,
          name,
          kind: edit.kind,
        });
        if (!payload) {
          return;
        }
        if (!payload.success) {
          toast.error(payload.error ?? t("workspace.fileExplorer.errors.createFailed"));
          return;
        }
        if (edit.kind === "file" && payload.path) {
          selectExplorerEntry(payload.path);
          onOpenFile?.(payload.path);
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [createEntry, onOpenFile, pendingEdit, selectExplorerEntry, t, toast],
  );

  const handleRenameCommit = useCallback(
    async (name: string) => {
      const edit = pendingEdit;
      setPendingEdit(null);
      if (edit?.type !== "rename" || name === edit.entry.name) {
        return;
      }
      const { entry } = edit;
      try {
        const payload = await renameEntry({
          path: entry.path,
          name,
        });
        if (!payload) {
          return;
        }
        if (!payload.success || !payload.renamedPath) {
          toast.error(payload.error ?? t("workspace.fileExplorer.errors.renameFailed"));
          return;
        }

        const renamedPath = payload.renamedPath;
        if (workspaceStateKey && entry.kind === "directory") {
          const expandedRenamedPaths = Array.from(expandedPaths)
            .filter((expandedPath) => isExplorerPathWithin(expandedPath, entry.path))
            .map((expandedPath) =>
              replaceExplorerPathPrefix(expandedPath, entry.path, renamedPath),
            );
          setExpandedPathsForWorkspace(workspaceStateKey, (currentPaths) =>
            currentPaths.map((currentPath) =>
              isExplorerPathWithin(currentPath, entry.path)
                ? replaceExplorerPathPrefix(currentPath, entry.path, renamedPath)
                : currentPath,
            ),
          );
          await Promise.all(
            expandedRenamedPaths.map((expandedPath) =>
              requestDirectoryListing(expandedPath, {
                recordHistory: false,
                setCurrentPath: false,
              }),
            ),
          );
        }
        if (selectedEntryPath && isExplorerPathWithin(selectedEntryPath, entry.path)) {
          const renamedSelection = replaceExplorerPathPrefix(
            selectedEntryPath,
            entry.path,
            renamedPath,
          );
          selectExplorerEntry(renamedSelection);
          if (entry.kind === "file") {
            onOpenFile?.(renamedSelection);
          }
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [
      expandedPaths,
      onOpenFile,
      pendingEdit,
      requestDirectoryListing,
      renameEntry,
      selectExplorerEntry,
      selectedEntryPath,
      setExpandedPathsForWorkspace,
      t,
      toast,
      workspaceStateKey,
    ],
  );

  const handleDuplicateEntry = useCallback(
    async (entry: ExplorerEntry) => {
      try {
        const payload = await duplicateEntry(entry.path);
        if (!payload) {
          return;
        }
        if (!payload.success || !payload.duplicatedPath) {
          toast.error(payload.error ?? t("workspace.fileExplorer.errors.duplicateFailed"));
          return;
        }
        selectExplorerEntry(payload.duplicatedPath);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [duplicateEntry, selectExplorerEntry, t, toast],
  );

  const handleDeleteEntry = useCallback(
    async (entry: ExplorerEntry) => {
      const confirmed = await confirmDialog({
        title:
          entry.kind === "directory"
            ? t("workspace.fileActions.confirmDelete.folderTitle")
            : t("workspace.fileActions.confirmDelete.fileTitle"),
        message: t("workspace.fileActions.confirmDelete.message", { name: entry.name }),
        confirmLabel: t("workspace.fileActions.confirmDelete.confirm"),
        cancelLabel: t("workspace.fileActions.confirmDelete.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      try {
        const payload = await deleteEntry(entry.path);
        if (!payload) {
          return;
        }
        if (!payload.success) {
          toast.error(payload.error ?? t("workspace.fileExplorer.errors.deleteFailed"));
          return;
        }
        if (selectedEntryPath === entry.path) {
          selectExplorerEntry(null);
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [deleteEntry, selectExplorerEntry, selectedEntryPath, t, toast],
  );

  const handleSortCycle = useCallback(() => {
    const currentIndex = SORT_OPTIONS.findIndex((opt) => opt.value === sortOption);
    const nextIndex = (currentIndex + 1) % SORT_OPTIONS.length;
    setSortOption(SORT_OPTIONS[nextIndex].value);
  }, [sortOption, setSortOption]);

  const handleToggleHiddenFiles = useCallback(() => {
    const willShow = !usePanelStore.getState().explorerShowHiddenFiles;
    if (!willShow) {
      toggleExplorerShowHiddenFiles();
      return;
    }
    const rootDirectory = directories.get(".");
    if (!rootDirectory || !workspaceStateKey) {
      toggleExplorerShowHiddenFiles();
      return;
    }
    void showHiddenFilesAndRestoreExpandedDirectories({
      rootDirectory,
      persistedExpandedPaths: expandedPaths,
      showHiddenFiles: toggleExplorerShowHiddenFiles,
      requestDirectoryListing: (path) =>
        requestDirectoryListing(path, {
          recordHistory: false,
          setCurrentPath: false,
        }),
    }).then((restoredPaths) => {
      setExpandedPathsForWorkspace(workspaceStateKey, (currentPaths) =>
        reconcileRestoredExpandedPaths({
          persistedExpandedPaths: expandedPaths,
          currentExpandedPaths: new Set(currentPaths),
          restoredExpandedPaths: restoredPaths,
        }),
      );
      return null;
    });
  }, [
    directories,
    expandedPaths,
    requestDirectoryListing,
    setExpandedPathsForWorkspace,
    toggleExplorerShowHiddenFiles,
    workspaceStateKey,
  ]);

  const refreshExplorer = useCallback(
    () =>
      refreshExplorerDirectories({
        hasWorkspaceScope,
        expandedPaths,
        requestDirectoryListing,
      }),
    [expandedPaths, hasWorkspaceScope, requestDirectoryListing],
  );
  const { refetch: refetchExplorer, isFetching: isRefreshFetching } = useQuery({
    queryKey: ["fileExplorerRefresh", serverId, workspaceStateKey],
    queryFn: refreshExplorer,
    enabled: false,
  });

  const handleRefresh = useCallback(() => {
    void refetchExplorer();
  }, [refetchExplorer]);

  const sortLabels = useMemo(
    () => ({
      name: t("workspace.fileExplorer.sort.name"),
      modified: t("workspace.fileExplorer.sort.modified"),
      size: t("workspace.fileExplorer.sort.size"),
    }),
    [t],
  );
  const currentSortLabel = resolveCurrentSortLabel(sortOption, sortLabels);

  const treeRows = useMemo(
    () => flattenExplorerTree({ directories, expandedPaths, sortOption, showHiddenFiles }),
    [directories, expandedPaths, showHiddenFiles, sortOption],
  );

  const listRows = useMemo<ExplorerListRow[]>(() => {
    const rows: ExplorerListRow[] = treeRows.map((row) =>
      pendingEdit?.type === "rename" && pendingEdit.entry.path === row.entry.path
        ? { type: "rename", entry: row.entry, depth: row.depth }
        : { type: "entry", row },
    );
    if (pendingEdit?.type !== "create") {
      return rows;
    }
    let insertionIndex = 0;
    let depth = 0;
    if (pendingEdit.parentPath !== ".") {
      const parentIndex = treeRows.findIndex((row) => row.entry.path === pendingEdit.parentPath);
      if (parentIndex >= 0) {
        insertionIndex = parentIndex + 1;
        depth = treeRows[parentIndex].depth + 1;
      }
    }
    rows.splice(insertionIndex, 0, {
      type: "draft",
      parentPath: pendingEdit.parentPath,
      kind: pendingEdit.kind,
      depth,
    });
    return rows;
  }, [pendingEdit, treeRows]);

  const showInitialLoading = resolveShowInitialLoading({
    directories,
    isExplorerLoading,
    pendingRequest,
  });
  const showBackFromError = Boolean(error && selectedEntryPath);
  const errorRecoveryPath = useMemo(() => getErrorRecoveryPath(explorerState), [explorerState]);

  const renderTreeRow = useCallback(
    (info: ListRenderItemInfo<ExplorerListRow>) => {
      if (info.item.type === "draft") {
        return (
          <EntryNameInputRow
            depth={info.item.depth}
            kind={info.item.kind}
            onCommit={handleDraftCommit}
            onCancel={handleEditCancel}
          />
        );
      }
      if (info.item.type === "rename") {
        return (
          <EntryNameInputRow
            depth={info.item.depth}
            kind={info.item.entry.kind}
            initialName={info.item.entry.name}
            onCommit={handleRenameCommit}
            onCancel={handleEditCancel}
          />
        );
      }
      return (
        <TreeRowDispatcher
          serverId={serverId}
          workspaceId={workspaceId}
          row={info.item.row}
          index={info.index}
          expandedPaths={expandedPaths}
          selectedEntryPath={selectedEntryPath}
          isDirectoryLoading={isDirectoryLoading}
          onEntryPress={handleEntryPress}
          onSelectEntry={handleSelectEntry}
          onCopyPath={handleCopyPath}
          onCopyRelativePath={handleCopyRelativePath}
          onDownloadEntry={handleDownloadEntry}
          onAddToChat={onAddToChat}
          onOpenFileToSide={onOpenFileToSide}
          onNewEntry={fsEntryOpsEnabled ? handleNewEntry : undefined}
          onCollapseDirectory={handleCollapseDirectory}
          onRenameEntry={fsEntryOpsEnabled ? handleRenameEntry : undefined}
          onDuplicateEntry={fsEntryDuplicateEnabled ? handleDuplicateEntry : undefined}
          onDeleteEntry={fsEntryOpsEnabled ? handleDeleteEntry : undefined}
        />
      );
    },
    [
      expandedPaths,
      fsEntryDuplicateEnabled,
      fsEntryOpsEnabled,
      handleCollapseDirectory,
      handleCopyPath,
      handleCopyRelativePath,
      handleDeleteEntry,
      handleDownloadEntry,
      handleDraftCommit,
      handleDuplicateEntry,
      handleEditCancel,
      handleEntryPress,
      handleNewEntry,
      handleRenameCommit,
      handleRenameEntry,
      handleSelectEntry,
      isDirectoryLoading,
      selectedEntryPath,
      onAddToChat,
      onOpenFileToSide,
      serverId,
      workspaceId,
    ],
  );

  const handleBackFromError = useCallback(() => {
    if (!hasWorkspaceScope) {
      return;
    }
    selectExplorerEntry(null);
    void requestDirectoryListing(errorRecoveryPath, {
      recordHistory: false,
      setCurrentPath: true,
    });
  }, [errorRecoveryPath, hasWorkspaceScope, requestDirectoryListing, selectExplorerEntry]);

  const handleRetry = useCallback(() => {
    void requestDirectoryListing(".", {
      recordHistory: false,
      setCurrentPath: false,
    });
  }, [requestDirectoryListing]);

  if (!hasWorkspaceScope) {
    return (
      <div className={CENTER_STATE}>
        <span className="text-center text-sm text-destructive">
          {t("workspace.fileExplorer.states.unavailable")}
        </span>
      </div>
    );
  }

  return (
    <div onContextMenu={preventContextMenu} className="flex min-h-0 flex-1 flex-col">
      <FileExplorerPaneContent
        error={error}
        isCompact={isCompact}
        showInitialLoading={showInitialLoading}
        showBackFromError={showBackFromError}
        listRows={listRows}
        onNewEntryAtRoot={fsEntryOpsEnabled ? handleNewEntry : undefined}
        currentSortLabel={currentSortLabel}
        isRefreshFetching={isRefreshFetching}
        treeListRef={treeListRef}
        renderTreeRow={renderTreeRow}
        handleSortCycle={handleSortCycle}
        handleToggleHiddenFiles={handleToggleHiddenFiles}
        handleRefresh={handleRefresh}
        handleBackFromError={handleBackFromError}
        handleRetry={handleRetry}
      />
    </div>
  );
}

interface FileExplorerPaneContentProps {
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
                <FilePlus size={iconSize} className="text-extra-muted-foreground" />
              </ToolbarButton>
              <ToolbarButton
                label={t("workspace.fileActions.newFolder")}
                compact={isCompact}
                testID="files-new-folder"
                onPress={handleNewFolderAtRoot}
              >
                <FolderPlus size={iconSize} className="text-extra-muted-foreground" />
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
              <Eye size={iconSize} className="text-extra-muted-foreground" />
            ) : (
              <EyeOff size={iconSize} className="text-extra-muted-foreground" />
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
                <Spinner className="size-3.5 text-extra-muted-foreground" />
              ) : (
                <RotateCw size={iconSize} className="text-extra-muted-foreground" />
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
                className={cn(
                  "min-h-0 flex-1 overflow-y-auto",
                  !isCompact && HIDE_NATIVE_SCROLLBAR,
                )}
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

function deriveExplorerFields(state: AgentFileExplorerState | undefined) {
  return {
    directories:
      state?.directories ?? new Map<string, { path: string; entries: ExplorerEntry[] }>(),
    pendingRequest: state?.pendingRequest ?? null,
    isExplorerLoading: state?.isLoading ?? false,
    error: state?.lastError ?? null,
    selectedEntryPath: state?.selectedEntryPath ?? null,
  };
}

function isPendingListForPath({
  isExplorerLoading,
  pendingRequest,
  path,
}: {
  isExplorerLoading: boolean;
  pendingRequest: AgentFileExplorerState["pendingRequest"] | null;
  path: string;
}): boolean {
  return Boolean(
    isExplorerLoading && pendingRequest?.mode === "list" && pendingRequest?.path === path,
  );
}

function resolveShowInitialLoading({
  directories,
  isExplorerLoading,
  pendingRequest,
}: {
  directories: Map<string, unknown>;
  isExplorerLoading: boolean;
  pendingRequest: AgentFileExplorerState["pendingRequest"] | null;
}): boolean {
  if (directories.has(".")) {
    return false;
  }
  return Boolean(
    isExplorerLoading && pendingRequest?.mode === "list" && pendingRequest?.path === ".",
  );
}

function resolveCurrentSortLabel(
  sortOption: SortOption,
  labels: Record<SortOption, string>,
): string {
  return labels[sortOption] ?? labels.name;
}

function toggleDirectory({
  entry,
  workspaceStateKey,
  expandedPaths,
  directories,
  requestDirectoryListing,
  setExpandedPathsForWorkspace,
}: {
  entry: ExplorerEntry;
  workspaceStateKey: string | null;
  expandedPaths: Set<string>;
  directories: Map<string, ExplorerDirectory>;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<ExplorerDirectory | null>;
  setExpandedPathsForWorkspace: (workspaceStateKey: string, paths: ExpandedPathsUpdate) => void;
}): void {
  if (!workspaceStateKey) {
    return;
  }
  const isExpanded = expandedPaths.has(entry.path);
  setExpandedPathsForWorkspace(workspaceStateKey, (currentPaths) =>
    setExpandedDirectoryPath({
      currentExpandedPaths: currentPaths,
      directoryPath: entry.path,
      expanded: !isExpanded,
    }),
  );
  if (!isExpanded && !directories.has(entry.path)) {
    void requestDirectoryListing(entry.path, {
      recordHistory: false,
      setCurrentPath: false,
    });
  }
}

function TreeRowDispatcher({
  serverId,
  workspaceId,
  row,
  index,
  expandedPaths,
  selectedEntryPath,
  isDirectoryLoading,
  onEntryPress,
  onSelectEntry,
  onCopyPath,
  onCopyRelativePath,
  onDownloadEntry,
  onAddToChat,
  onOpenFileToSide,
  onNewEntry,
  onCollapseDirectory,
  onRenameEntry,
  onDuplicateEntry,
  onDeleteEntry,
}: {
  serverId: string;
  workspaceId?: string | null;
  row: ExplorerTreeRow;
  index: number;
  expandedPaths: Set<string>;
  selectedEntryPath: string | null;
  isDirectoryLoading: (path: string) => boolean;
  onEntryPress: (entry: ExplorerEntry) => void;
  onSelectEntry: (entry: ExplorerEntry) => void;
  onCopyPath: (path: string) => void | Promise<void>;
  onCopyRelativePath: (path: string) => void | Promise<void>;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onAddToChat?: (path: string) => void;
  onOpenFileToSide?: (path: string) => void;
  onNewEntry?: (parentPath: string, kind: "file" | "directory") => void;
  onCollapseDirectory?: (path: string) => void;
  onRenameEntry?: (entry: ExplorerEntry) => void;
  onDuplicateEntry?: (entry: ExplorerEntry) => void;
  onDeleteEntry?: (entry: ExplorerEntry) => void;
}) {
  const entry = row.entry;
  const depth = row.depth;
  const isDirectory = entry.kind === "directory";
  const isExpanded = isDirectory && expandedPaths.has(entry.path);
  const isSelected = selectedEntryPath === entry.path;
  const loading = isDirectory && isDirectoryLoading(entry.path);

  return (
    <TreeRowItem
      serverId={serverId}
      workspaceId={workspaceId}
      entry={entry}
      depth={depth}
      isExpanded={isExpanded}
      isSelected={isSelected}
      loading={loading}
      onEntryPress={onEntryPress}
      onSelectEntry={onSelectEntry}
      onCopyPath={onCopyPath}
      onCopyRelativePath={onCopyRelativePath}
      onDownloadEntry={onDownloadEntry}
      onAddToChat={onAddToChat}
      onOpenFileToSide={onOpenFileToSide}
      onNewEntry={onNewEntry}
      onCollapseDirectory={onCollapseDirectory}
      onRenameEntry={onRenameEntry}
      onDuplicateEntry={onDuplicateEntry}
      onDeleteEntry={onDeleteEntry}
      testID={`file-explorer-row-${index}`}
    />
  );
}

function isExplorerPathWithin(candidatePath: string, parentPath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}/`);
}

function replaceExplorerPathPrefix(
  candidatePath: string,
  previousPrefix: string,
  nextPrefix: string,
): string {
  return `${nextPrefix}${candidatePath.slice(previousPrefix.length)}`;
}

async function initializeExplorer({
  hasWorkspaceScope,
  hasInitializedRef,
  workspaceStateKey,
  persistedExpandedPaths,
  showHiddenFiles,
  requestDirectoryListing,
  setExpandedPathsForWorkspace,
}: {
  hasWorkspaceScope: boolean;
  hasInitializedRef: RefObject<boolean>;
  workspaceStateKey: string | null;
  persistedExpandedPaths: ReadonlySet<string>;
  showHiddenFiles: boolean;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<ExplorerDirectory | null>;
  setExpandedPathsForWorkspace: (workspaceStateKey: string, paths: ExpandedPathsUpdate) => void;
}): Promise<void> {
  if (!hasWorkspaceScope || hasInitializedRef.current) {
    return;
  }
  hasInitializedRef.current = true;
  const rootDirectory = await requestDirectoryListing(".", {
    recordHistory: false,
    setCurrentPath: false,
  });
  if (!rootDirectory) {
    hasInitializedRef.current = false;
    return;
  }
  if (!workspaceStateKey) {
    return;
  }

  const restoredPaths = await restoreExpandedDirectories({
    rootDirectory,
    persistedExpandedPaths,
    showHiddenFiles,
    requestDirectoryListing: (path) =>
      requestDirectoryListing(path, {
        recordHistory: false,
        setCurrentPath: false,
      }),
  });
  const hiddenPersistedPaths = showHiddenFiles
    ? []
    : Array.from(persistedExpandedPaths).filter(isHiddenExplorerPath);
  const restoredPathsWithHidden = [...restoredPaths, ...hiddenPersistedPaths];
  setExpandedPathsForWorkspace(workspaceStateKey, (currentPaths) =>
    reconcileRestoredExpandedPaths({
      persistedExpandedPaths,
      currentExpandedPaths: new Set(currentPaths),
      restoredExpandedPaths: restoredPathsWithHidden,
    }),
  );
}

async function refreshExplorerDirectories({
  hasWorkspaceScope,
  expandedPaths,
  requestDirectoryListing,
}: {
  hasWorkspaceScope: boolean;
  expandedPaths: Set<string>;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<ExplorerDirectory | null>;
}): Promise<null> {
  if (!hasWorkspaceScope) {
    return null;
  }
  const showHiddenFiles = usePanelStore.getState().explorerShowHiddenFiles;
  const directoryPaths = Array.from(expandedPaths).filter(
    (path) => showHiddenFiles || !isHiddenExplorerPath(path),
  );
  if (!directoryPaths.includes(".")) {
    directoryPaths.unshift(".");
  }
  await Promise.all(
    directoryPaths.map((path) =>
      requestDirectoryListing(path, {
        recordHistory: false,
        setCurrentPath: false,
      }),
    ),
  );
  return null;
}

function getErrorRecoveryPath(state: AgentFileExplorerState | undefined): string {
  if (!state) {
    return ".";
  }

  const currentHistoryPath =
    state.history.length > 0 ? state.history[state.history.length - 1] : null;
  const candidate = currentHistoryPath ?? state.lastVisitedPath ?? state.currentPath;

  if (!candidate || candidate.length === 0) {
    return ".";
  }
  return candidate;
}
