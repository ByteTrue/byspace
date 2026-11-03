// Content on the left, a tree on the right: a shadcn Resizable group. The tree keeps its pixel
// width as the pane resizes, and its width is stored when a drag ends.
import { Children, useCallback, type ReactNode } from "react";
import { usePanelRef, type LayoutChangedMeta } from "react-resizable-panels";
import { MIN_TREE_RAIL_WIDTH, usePanelStore } from "@/stores/panel-store";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";

const MIN_CONTENT_WIDTH = 240;
const MAX_TREE_WIDTH = 600;

export interface TreeRailProps {
  /** Exactly two children, in order: content, then tree. */
  children: ReactNode;
  testID?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  minimumWidth?: number;
}

/** Content-left/tree-right master-detail geometry with one app-wide tree width. */
export function TreeRail({ children, testID, width, onWidthChange, minimumWidth }: TreeRailProps) {
  const [content, tree] = Children.toArray(children);
  const sharedWidth = usePanelStore((state) => state.treeRailWidth);
  const setSharedWidth = usePanelStore((state) => state.setTreeRailWidth);
  const commitWidth = onWidthChange ?? setSharedWidth;
  const treePanelRef = usePanelRef();
  const handleLayoutChanged = useCallback(
    (_layout: unknown, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const size = treePanelRef.current?.getSize().inPixels;
      if (size) commitWidth(Math.round(size));
    },
    [commitWidth, treePanelRef],
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      data-testid={testID}
      onLayoutChanged={handleLayoutChanged}
    >
      <ResizablePanel
        id="content"
        minSize={MIN_CONTENT_WIDTH}
        className="flex min-w-0 flex-col"
        data-testid={testID ? `${testID}-content` : undefined}
      >
        {content}
      </ResizablePanel>
      <ResizableHandle
        data-testid={testID ? `${testID}-resize-handle` : "tree-rail-resize-handle"}
      />
      <ResizablePanel
        id="tree"
        panelRef={treePanelRef}
        defaultSize={width ?? sharedWidth}
        minSize={minimumWidth ?? MIN_TREE_RAIL_WIDTH}
        maxSize={MAX_TREE_WIDTH}
        groupResizeBehavior="preserve-pixel-size"
        className="flex flex-col"
        data-testid={testID ? `${testID}-tree` : undefined}
      >
        {tree}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
