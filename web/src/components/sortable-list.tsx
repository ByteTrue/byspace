import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getDragActivationConstraints, useDragReorderState } from "@/components/drag-reorder";

// Same activation as the Expo app's DraggableList: a 6px drag with the mouse, a 180ms hold on touch.
const DRAG_ACTIVATION = getDragActivationConstraints(true, {
  movementDistance: 6,
  touchHoldDelayMs: 180,
  touchHoldTolerance: 8,
});

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const MODIFIERS = [restrictToVerticalAxis];
// Space picks a row up from the keyboard; Enter stays with the row's own action.
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] };

/** What a sortable row applies: its node and style on the outer element, the handle where a drag starts. */
export interface SortableItemProps {
  nodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  handle: {
    ref: (node: HTMLElement | null) => void;
    listeners: Record<string, unknown> | undefined;
  };
}

function SortableItem<T>({
  id,
  item,
  render,
}: {
  id: string;
  item: T;
  render: (item: T, sortable: SortableItemProps) => ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id });
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Transform.toString(transform ? { ...transform, scaleX: 1, scaleY: 1 } : null),
      transition,
      position: "relative",
      zIndex: isDragging ? 10 : undefined,
    }),
    [isDragging, transform, transition],
  );
  return render(item, {
    nodeRef: setNodeRef,
    style,
    isDragging,
    handle: { ref: setActivatorNodeRef, listeners },
  });
}

/** A vertical list the user reorders by dragging, as the Expo app's DraggableList on the web. */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  render,
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder: (items: T[]) => void;
  render: (item: T, sortable: SortableItemProps) => ReactNode;
}) {
  const keyExtractor = (item: T) => getId(item);
  const { items: ordered, handlers } = useDragReorderState({
    data: items,
    keyExtractor,
    onDragEnd: onReorder,
  });
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: DRAG_ACTIVATION.mouse }),
    useSensor(TouchSensor, { activationConstraint: DRAG_ACTIVATION.touch }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    }),
  );
  const ids = useMemo(() => ordered.map(getId), [getId, ordered]);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={MODIFIERS}
      onDragStart={handlers.onDragStart}
      onDragCancel={handlers.onDragCancel}
      onDragEnd={handlers.onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ordered.map((item) => (
          <SortableItem key={getId(item)} id={getId(item)} item={item} render={render} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
