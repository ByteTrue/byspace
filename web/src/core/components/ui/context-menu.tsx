// A row or chip that opens shadcn's ContextMenu on a right click or a touch long press, and is also
// pressable itself: a click, Enter or Space runs `onPress`, a primary pointer down runs
// `onPressIn`, and a held press runs `onLongPress` (a row selects itself). shadcn's trigger knows
// only the context gesture, and every row here also presses, so the two live together.
import type {
  ComponentProps,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  Ref,
} from "react";
import { ContextMenuTrigger as ShadcnContextMenuTrigger } from "~/components/ui/context-menu";
import { useLongPress } from "~/hooks/use-long-press";
import { composeHandlers, mergeRefs } from "~/lib/compose";

type ContextMenuTriggerProps = Omit<ComponentProps<"div">, "ref" | "style"> & {
  ref?: Ref<HTMLDivElement>;
  triggerRef?: Ref<HTMLDivElement | null>;
  style?: CSSProperties;
  /** False turns the context gesture off. */
  enabled?: boolean;
  longPressDelayMs?: number;
  /** Only the context gesture does anything; a plain press passes through. */
  contextOnly?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onPressIn?: () => void;
  onLongPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: "button";
};

export function ContextMenuTrigger({
  ref,
  triggerRef,
  children,
  contextOnly = false,
  disabled,
  enabled = true,
  longPressDelayMs,
  onPress,
  onPressIn,
  onLongPress,
  testID,
  accessibilityLabel,
  accessibilityRole,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onKeyDown,
  onContextMenu,
  ...props
}: ContextMenuTriggerProps): ReactElement {
  const pressable = !contextOnly && !disabled && Boolean(onPress || onPressIn);
  const longPress = useLongPress(onLongPress ? () => onLongPress() : undefined, longPressDelayMs);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!pressable || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPressIn?.();
    onPress?.();
  };
  // React bubbles a right-click in a portaled menu (a row's, opened inside this area) up to this
  // trigger; it is not on this element, so it must not open this menu too.
  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) {
      event.preventDefault();
    }
  };
  return (
    <ShadcnContextMenuTrigger asChild disabled={!enabled}>
      <div
        {...props}
        ref={mergeRefs(ref, triggerRef)}
        role={accessibilityRole === "button" || pressable ? "button" : undefined}
        tabIndex={pressable ? 0 : undefined}
        aria-label={accessibilityLabel}
        aria-disabled={disabled || undefined}
        data-testid={testID}
        onClick={composeHandlers(onClick, pressable && onPress ? () => onPress() : undefined)}
        onPointerDown={composeHandlers(
          composeHandlers(onPointerDown, longPress.onPointerDown),
          pressable && onPressIn ? (event) => event.button === 0 && onPressIn() : undefined,
        )}
        // Composed, not replaced: a tooltip around the trigger (a workspace tab) opens on pointermove.
        onPointerMove={composeHandlers(onPointerMove, longPress.onPointerMove)}
        onPointerUp={composeHandlers(onPointerUp, longPress.onPointerUp)}
        onPointerCancel={composeHandlers(onPointerCancel, longPress.onPointerCancel)}
        onPointerLeave={composeHandlers(onPointerLeave, longPress.onPointerLeave)}
        onKeyDown={composeHandlers(onKeyDown, handleKeyDown)}
        onContextMenu={composeHandlers(handleContextMenu, onContextMenu)}
      >
        {children}
      </div>
    </ShadcnContextMenuTrigger>
  );
}
