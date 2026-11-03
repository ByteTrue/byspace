// Port of archive/expo-app:packages/app/src/components/tree-primitives.tsx: the rows both workspace trees share
// (Files and Changes) — indentation, density, name emphasis and the disclosure chevron.
import { ChevronRight } from "lucide-react";
import { SPACING } from "@/styles/theme";
import { cn } from "cn";

export const TREE_INDENT_PER_LEVEL = 12;
export const WORKSPACE_FILE_ROW_VERTICAL_PADDING = SPACING[1.5];
export const WORKSPACE_TREE_ICON_SIZE = 16;
export const WORKSPACE_TREE_LOADING_ICON_SIZE = 14;
export const WORKSPACE_TREE_ICON_LABEL_GAP = SPACING[2];
/** Shared painted-edge rail for pane headers, toolbars, and tree/diff rows. */
export const WORKSPACE_PANE_TRAILING_GLYPH_RAIL = SPACING[2];

/** Left padding for a row in either workspace tree. */
export function treeRowPaddingLeft(depth: number): number {
  return SPACING[3] + depth * TREE_INDENT_PER_LEVEL;
}

/** Rotating disclosure chevron for a directory row (points right; rotates down when expanded). */
export function TreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center text-extra-muted-foreground",
        expanded && "rotate-90",
      )}
    >
      <ChevronRight size={WORKSPACE_TREE_ICON_SIZE} />
    </span>
  );
}

/**
 * A tree row's classes: the row, its hover/selected fill, and its name, which is muted until the
 * row is hovered (the `group` on the row).
 */
export const workspaceTreeRowClassNames = {
  // 30px like the Expo rows: 6px above and below an 18px line (Geist's normal line height).
  row: "group/tree-row flex items-center justify-between py-1.5 pr-2",
  active: "bg-sidebar-accent",
  hoverable: "hover:bg-sidebar-accent active:bg-sidebar-accent",
  // An opacity on the label, as in the Expo app's tree-primitives.tsx, not a translucent colour.
  name: "text-foreground opacity-76 group-hover/tree-row:opacity-100",
} as const;
