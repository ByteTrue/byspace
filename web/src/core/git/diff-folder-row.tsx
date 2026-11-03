// Port of packages/app/src/git/diff-folder-row.tsx: a folder in the Changes tree — press to
// collapse or expand, its summed diff stat, and the folder menu. The view is DOM.
import { useCallback, useMemo } from "react";
import { DiffStat } from "@/components/diff-stat";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import {
  TreeChevron,
  treeRowPaddingLeft,
  workspaceTreeRowClassNames,
} from "@/components/tree-primitives";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "cn";

interface DiffFolderRowProps {
  /** full uncompressed directory path — the collapse identity */
  dirPath: string;
  displayName: string;
  depth: number;
  collapsed: boolean;
  isSelected: boolean;
  additions: number;
  deletions: number;
  onToggle: (dirPath: string) => void;
  onCollapse: (dirPath: string) => void;
  onSelect: (dirPath: string) => void;
  onHeightChange?: (height: number) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onDuplicate?: (path: string) => void;
  onRevert?: (path: string) => void;
  testID?: string;
}

export function DiffFolderRow({
  dirPath,
  displayName,
  depth,
  collapsed,
  isSelected,
  additions,
  deletions,
  onToggle,
  onCollapse,
  onSelect,
  onCopyPath,
  onCopyRelativePath,
  onDuplicate,
  onRevert,
  testID,
}: DiffFolderRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(dirPath);
  }, [dirPath, onSelect]);

  const handlePress = useCallback(() => {
    // A press that ends a text selection is not a toggle.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return;
    }
    handleSelect();
    onToggle(dirPath);
  }, [dirPath, handleSelect, onToggle]);

  const handleCollapse = useCallback(() => onCollapse(dirPath), [dirPath, onCollapse]);
  const handleCopyPath = useCallback(() => onCopyPath?.(dirPath), [dirPath, onCopyPath]);
  const handleCopyRelativePath = useCallback(
    () => onCopyRelativePath?.(dirPath),
    [dirPath, onCopyRelativePath],
  );
  const handleDuplicate = useCallback(() => onDuplicate?.(dirPath), [dirPath, onDuplicate]);
  const handleRevert = useCallback(() => onRevert?.(dirPath), [dirPath, onRevert]);
  const leftStyle = useMemo(() => ({ paddingLeft: treeRowPaddingLeft(depth) }), [depth]);

  return (
    <div className="overflow-hidden" data-testid={testID}>
      <ContextMenu>
        <ContextMenuTrigger
          onPress={handlePress}
          onContextMenu={handleSelect}
          onLongPress={handleSelect}
          className={cn(
            workspaceTreeRowClassNames.row,
            workspaceTreeRowClassNames.hoverable,
            "cursor-pointer",
            isSelected && workspaceTreeRowClassNames.active,
          )}
          accessibilityRole="button"
          aria-expanded={!collapsed}
          aria-selected={isSelected}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2" style={leftStyle}>
            <span className="flex size-4 items-center justify-center">
              <TreeChevron expanded={!collapsed} />
            </span>
            <span
              className={cn(
                "min-w-0 shrink truncate text-sm select-none",
                workspaceTreeRowClassNames.name,
              )}
              data-testid={testID ? `${testID}-name` : undefined}
            >
              {displayName}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DiffStat
              additions={additions}
              deletions={deletions}
              testID={testID ? `${testID}-stat` : undefined}
            />
          </div>
        </ContextMenuTrigger>
        <FileActionsContextMenuContent
          fileKind="directory"
          onCollapseFolder={!collapsed ? handleCollapse : undefined}
          onCopyPath={onCopyPath ? handleCopyPath : undefined}
          onCopyRelativePath={onCopyRelativePath ? handleCopyRelativePath : undefined}
          onDuplicate={onDuplicate ? handleDuplicate : undefined}
          onRevert={onRevert ? handleRevert : undefined}
          testIDPrefix={testID}
        />
      </ContextMenu>
    </div>
  );
}
