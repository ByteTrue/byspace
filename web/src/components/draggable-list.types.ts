import type { CSSProperties, ReactElement } from "react";

export interface DraggableListDragHandleProps {
  /**
   * Web-only drag handle props (from dnd-kit). Spread these onto the element
   * that should initiate the drag. Native uses the `drag()` callback instead.
   */
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  setActivatorNodeRef?: (node: unknown) => void;
}

export interface DraggableRenderItemInfo<T> {
  item: T;
  index: number;
  drag: () => void;
  isActive: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

export interface DraggableListProps<T> {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: DraggableRenderItemInfo<T>) => ReactElement;
  onDragEnd: (data: T[]) => void;
  style?: CSSProperties;
  /** Outer container style (useful for nested, non-scrolling lists). */
  containerStyle?: CSSProperties;
  contentContainerStyle?: CSSProperties;
  testID?: string;
  ListFooterComponent?: ReactElement | null;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  showsVerticalScrollIndicator?: boolean;
  /** When false, disables internal scrolling (use outer list to scroll). */
  scrollEnabled?: boolean;
  /**
   * Web-only: when true, the drag can only be initiated from the handle props
   * passed to `renderItem` (prevents nested lists from fighting).
   */
  useDragHandle?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Fill remaining space when content is smaller than container */
  contentContainerFlexGrow?: boolean;
  /** External row state that should invalidate virtualized native cells. */
  extraData?: unknown;
  /** Whether the retained native gesture host is currently presented. */
  gestureHostPresented?: boolean;
  /** Called when a drag gesture begins (before items are reordered) */
  onDragBegin?: () => void;
  /** Called immediately before invoking row `drag()` to lock outer owners. */
  onDragIntent?: () => void;
  /** Called when drag interaction ends (finger released). */
  onDragRelease?: () => void;
  /**
   * Native-only: use the nestable draggable-flatlist variant for nested drag
   * lists coordinated by a shared NestableScrollContainer.
   */
  nestable?: boolean;
}
