// Override of packages/app/src/git/file-header.tsx: a changed file's row — in the Changes tree, or
// as the header above its hunks in the diff document. Press, select, the file menu, the path tooltip
// and dragging the file into the composer are the Expo file's; the view is DOM. Over the canvas
// diff the header is painted, so this row is a transparent hit layer that reports hover and press.
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefCallback,
} from "react";
import { useWorkspaceFileDragSource } from "@/attachments/use-workspace-file-drag-source.web";
import { DiffStat } from "@/components/diff-stat";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import { FileChangeIcon } from "@/components/file-change-icon";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  treeRowPaddingLeft,
  workspaceTreeRowClassNames,
  WORKSPACE_TREE_ICON_SIZE,
} from "@/components/tree-primitives";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFileHeaderInteraction } from "@/git/file-header-interaction";
import {
  diffFileChangeKind,
  directorySuffix,
  fileNameForPath,
  formatDiffCount,
} from "@/git/file-header-presentation";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { cn } from "cn";

export interface FileHeaderProps {
  file: ParsedDiffFile;
  workspaceFileDragScope?: { serverId: string; workspaceId: string };
  bodyVisible: boolean;
  showsBodyState?: boolean;
  isSelected?: boolean;
  depth?: number;
  showDir?: boolean;
  interactive?: boolean;
  onActivate?: (path: string) => void;
  onSelect?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenToSide?: (path: string) => void;
  onAddToChat?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onDownload?: (path: string) => void;
  onDuplicate?: (path: string) => void;
  onRevert?: (path: string, oldPath?: string) => void;
  onHeaderHeightChange?: (path: string, height: number) => void;
  testID?: string;
  canvasRendered?: boolean;
  onActiveChange?: (active: boolean) => void;
}

function fileHeaderAccessibilityLabel(canvasRendered: boolean, file: ParsedDiffFile) {
  if (!canvasRendered) return undefined;
  return `${file.path}, +${formatDiffCount(file.additions)}, -${formatDiffCount(file.deletions)}`;
}

function useFileHeaderHover(enabled: boolean, onActiveChange?: (active: boolean) => void) {
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => {
    if (!enabled) return;
    setIsHovered(true);
    onActiveChange?.(true);
  }, [enabled, onActiveChange]);
  const handlePointerLeave = useCallback(() => {
    setIsHovered(false);
    onActiveChange?.(false);
  }, [onActiveChange]);
  return { isHovered, handlePointerEnter, handlePointerLeave };
}

/** The row's frame and its hover, press and selected fill. */
function headerClassName(input: {
  showsBodyState: boolean;
  canvasRendered: boolean;
  isHovered: boolean;
  isSelected: boolean;
  interactive: boolean;
}): string {
  const { showsBodyState, canvasRendered, isHovered, isSelected, interactive } = input;
  // Over the canvas the painted header shows hover and press; the hit layer stays clear.
  if (canvasRendered) return "relative z-2 flex h-7 min-w-0 items-center outline-none";
  if (showsBodyState) {
    return cn(
      "relative z-2 flex h-7 min-w-0 items-center outline-none",
      isHovered && "bg-muted",
      interactive && "active:bg-muted",
    );
  }
  return cn(
    workspaceTreeRowClassNames.row,
    "relative z-2 min-w-0 gap-1 outline-none",
    (isHovered || isSelected) && workspaceTreeRowClassNames.active,
    interactive && "active:bg-sidebar-accent",
  );
}

function containerClassName(showsBodyState: boolean, canvasRendered: boolean): string {
  if (!showsBodyState) return "w-full overflow-hidden select-none";
  // 30px with its bottom border; over the canvas the border and fill are painted.
  return cn(
    "h-[30px] w-full overflow-hidden border-b select-none",
    canvasRendered ? "border-transparent" : "bg-background",
  );
}

function FileHeaderContent({
  file,
  showDir,
  showsBodyState,
  dragSourceRef,
  testID,
}: {
  file: ParsedDiffFile;
  showDir: boolean;
  showsBodyState: boolean;
  dragSourceRef: RefCallback<HTMLDivElement>;
  testID?: string;
}) {
  const fileName = fileNameForPath(file.path);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center justify-between select-none",
        showsBodyState && "h-7 pr-2 pl-3",
      )}
      data-testid={testID ? `${testID}-header-content` : undefined}
    >
      <div
        ref={dragSourceRef}
        className={cn("flex min-w-0 flex-1 items-center select-none", showDir ? "gap-1" : "gap-2")}
      >
        {showDir ? null : (
          <span className="flex size-4 shrink-0 items-center justify-center">
            <MaterialFileIcon fileName={fileName} size={WORKSPACE_TREE_ICON_SIZE} />
          </span>
        )}
        <span
          className={cn(
            "min-w-0 shrink truncate text-sm leading-[18px] text-foreground",
            !showsBodyState && workspaceTreeRowClassNames.name,
          )}
          data-testid={testID ? `${testID}-name` : undefined}
        >
          {fileName}
        </span>
        {showDir ? (
          <span className="min-w-0 flex-1 truncate text-sm leading-[18px] text-muted-foreground">
            {directorySuffix(file.path)}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 select-none">
        <DiffStat
          additions={file.additions}
          deletions={file.deletions}
          testID={testID ? `${testID}-stat` : undefined}
        />
        <FileChangeIcon change={diffFileChangeKind(file)} />
      </div>
    </div>
  );
}

function FileHeaderMenu({
  file,
  onOpenFile,
  onOpenToSide,
  onAddToChat,
  onCopyPath,
  onCopyRelativePath,
  onDownload,
  onDuplicate,
  onRevert,
  testID,
}: FileHeaderProps) {
  const openFile = useCallback(() => onOpenFile?.(file.path), [file.path, onOpenFile]);
  const openToSide = useCallback(() => onOpenToSide?.(file.path), [file.path, onOpenToSide]);
  const addToChat = useCallback(() => onAddToChat?.(file.path), [file.path, onAddToChat]);
  const copyPath = useCallback(() => onCopyPath?.(file.path), [file.path, onCopyPath]);
  const copyRelativePath = useCallback(
    () => onCopyRelativePath?.(file.path),
    [file.path, onCopyRelativePath],
  );
  const download = useCallback(() => onDownload?.(file.path), [file.path, onDownload]);
  const duplicate = useCallback(() => onDuplicate?.(file.path), [file.path, onDuplicate]);
  const revert = useCallback(
    () => onRevert?.(file.path, file.oldPath),
    [file.oldPath, file.path, onRevert],
  );
  return (
    <FileActionsContextMenuContent
      fileKind="file"
      fileExists={!file.isDeleted}
      onOpenFile={onOpenFile ? openFile : undefined}
      onOpenToSide={onOpenToSide ? openToSide : undefined}
      onCopyPath={onCopyPath ? copyPath : undefined}
      onCopyRelativePath={onCopyRelativePath ? copyRelativePath : undefined}
      onDownload={onDownload ? download : undefined}
      onAddToChat={onAddToChat ? addToChat : undefined}
      onDuplicate={!file.isDeleted && onDuplicate ? duplicate : undefined}
      onRevert={onRevert ? revert : undefined}
      testIDPrefix={testID}
    />
  );
}

export const FileHeader = memo(function FileHeader({
  file,
  workspaceFileDragScope,
  bodyVisible,
  showsBodyState = true,
  isSelected = false,
  depth = 0,
  showDir = true,
  interactive = true,
  onActivate,
  onSelect,
  onHeaderHeightChange: _onHeaderHeightChange,
  testID,
  canvasRendered = false,
  onActiveChange,
  ...actions
}: FileHeaderProps) {
  const hover = useFileHeaderHover(interactive, onActiveChange);
  const dragSourceRef = useWorkspaceFileDragSource({
    enabled: interactive,
    disabled: file.isDeleted,
    workspaceId: null,
    path: file.path,
    ...workspaceFileDragScope,
  }) as RefCallback<HTMLDivElement>;
  const interaction = useFileHeaderInteraction({
    path: file.path,
    enabled: interactive,
    onSelect,
    onActivate,
  });
  const rowStyle = useMemo<CSSProperties | undefined>(
    () => (showsBodyState ? undefined : { paddingLeft: treeRowPaddingLeft(depth) }),
    [depth, showsBodyState],
  );
  const renderedContent = canvasRendered ? (
    <div ref={dragSourceRef} className="min-w-0 flex-1 self-stretch" />
  ) : (
    <FileHeaderContent
      file={file}
      showDir={showDir}
      showsBodyState={showsBodyState}
      dragSourceRef={dragSourceRef}
      testID={testID}
    />
  );
  const accessibilityLabel = fileHeaderAccessibilityLabel(canvasRendered, file);
  const handlePressIn = useCallback(() => {
    onActiveChange?.(true);
    interaction.onPressIn();
  }, [interaction, onActiveChange]);
  const handlePressOut = useCallback(() => {
    onActiveChange?.(false);
  }, [onActiveChange]);
  const className = headerClassName({
    showsBodyState,
    canvasRendered,
    isHovered: hover.isHovered,
    isSelected: !showsBodyState && isSelected,
    interactive,
  });
  let trigger: ReactElement;
  if (interactive) {
    trigger = (
      <ContextMenuTrigger
        testID={testID ? `${testID}-toggle` : undefined}
        className={className}
        style={rowStyle}
        onPressIn={handlePressIn}
        onPointerUp={handlePressOut}
        onPointerCancel={handlePressOut}
        onContextMenu={interaction.select}
        onPress={interaction.activate}
        accessibilityLabel={accessibilityLabel}
        aria-expanded={showsBodyState ? bodyVisible : undefined}
        aria-selected={isSelected}
      >
        {renderedContent}
      </ContextMenuTrigger>
    );
  } else {
    trigger = (
      <div className={className} style={rowStyle} aria-label={accessibilityLabel}>
        {renderedContent}
      </div>
    );
  }
  return (
    <div
      className={containerClassName(showsBodyState, canvasRendered)}
      onPointerEnter={hover.handlePointerEnter}
      onPointerLeave={hover.handlePointerLeave}
      data-testid={testID}
      aria-label={accessibilityLabel}
    >
      <ContextMenu>
        <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom" align="start" offset={6} maxWidth={520}>
            {file.path}
          </TooltipContent>
        </Tooltip>
        {interactive ? (
          <FileHeaderMenu file={file} testID={testID} {...actions} bodyVisible={bodyVisible} />
        ) : null}
      </ContextMenu>
    </div>
  );
});
