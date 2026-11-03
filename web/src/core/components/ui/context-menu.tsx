// The right-click shape of the menu engine: shadcn's ContextMenu. The trigger is the element itself
// (a tab chip, a row), so it renders a div Radix opens the menu from, on a right click or a touch
// long press.
import {
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { ContextMenuTrigger as RadixContextMenuTrigger } from "~/components/ui/context-menu";
import { useLongPress } from "~/hooks/use-long-press";
import { composeHandlers, mergeRefs } from "~/lib/compose";
import {
  MenuRoot,
  MenuSurface,
  useMenuContext,
  type MenuSurfaceProps,
  type MenuTriggerState,
} from "@/components/ui/menu";

export {
  MenuHint as ContextMenuHint,
  MenuItem as ContextMenuItem,
  MenuLabel as ContextMenuLabel,
  MenuSeparator as ContextMenuSeparator,
} from "@/components/ui/menu";
export type { ActionStatus } from "@/components/ui/menu";

export function ContextMenu(props: ComponentProps<typeof MenuRoot>): ReactElement {
  return <MenuRoot {...props} kind="context" />;
}

export function ContextMenuContent(props: MenuSurfaceProps): ReactElement {
  return <MenuSurface {...props} />;
}

export function useContextMenu() {
  return useMenuContext("useContextMenu");
}

type ContextMenuTriggerProps = PropsWithChildren<
  Omit<ComponentProps<"div">, "children" | "style" | "ref"> & {
    ref?: Ref<HTMLDivElement>;
    triggerRef?: Ref<HTMLDivElement | null>;
    style?: CSSProperties | ((state: MenuTriggerState) => unknown);
    children?: ReactNode | ((state: MenuTriggerState) => ReactNode);
    highlightStyle?: unknown;
    enabled?: boolean;
    enabledOnMobile?: boolean;
    enabledOnWeb?: boolean;
    longPressDelayMs?: number;
    /** Only the context gesture does anything; a plain press passes through. */
    contextOnly?: boolean;
    disabled?: boolean;
    onPress?: () => void;
    onPressIn?: () => void;
    onLongPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: unknown;
    accessibilityHint?: string;
  }
>;

export function ContextMenuTrigger({
  ref,
  triggerRef,
  children,
  contextOnly = false,
  disabled,
  style,
  highlightStyle: _highlightStyle,
  enabled = true,
  enabledOnMobile: _enabledOnMobile,
  enabledOnWeb = true,
  longPressDelayMs,
  onPress,
  onPressIn,
  onLongPress,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState: _accessibilityState,
  accessibilityHint: _accessibilityHint,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  onPointerEnter,
  onPointerLeave,
  onContextMenu: onContextMenuProp,
  ...props
}: ContextMenuTriggerProps): ReactElement {
  const { open } = useMenuContext("ContextMenuTrigger");
  const [hovered, setHovered] = useState(false);

  const pressable = !contextOnly && !disabled && Boolean(onPress || onPressIn);
  const content =
    typeof children === "function" ? children({ pressed: false, hovered, open }) : children;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!pressable || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPressIn?.();
    onPress?.();
  };
  // A row selects itself on a long press, as the Expo app's trigger forwarded it.
  const longPress = useLongPress(onLongPress ? () => onLongPress() : undefined, longPressDelayMs);
  const element = (
    <div
      {...props}
      ref={mergeRefs(ref, triggerRef)}
      role={accessibilityRole === "button" || pressable ? "button" : undefined}
      tabIndex={pressable ? 0 : undefined}
      aria-label={accessibilityLabel}
      aria-disabled={disabled || undefined}
      data-testid={testID}
      style={typeof style === "object" ? style : undefined}
      onContextMenu={onContextMenuProp}
      onClick={composeHandlers(onClick, pressable && onPress ? () => onPress() : undefined)}
      onPointerDown={composeHandlers(
        composeHandlers(onPointerDown, longPress.onPointerDown),
        pressable && onPressIn ? (event) => event.button === 0 && onPressIn() : undefined,
      )}
      // Composed, not replaced: a tooltip around the trigger (a workspace tab) opens on pointermove.
      onPointerMove={composeHandlers(onPointerMove, longPress.onPointerMove)}
      onPointerUp={composeHandlers(onPointerUp, longPress.onPointerUp)}
      onPointerCancel={composeHandlers(onPointerCancel, longPress.onPointerCancel)}
      onKeyDown={composeHandlers(onKeyDown, handleKeyDown)}
      onPointerEnter={composeHandlers(onPointerEnter, () => setHovered(true))}
      onPointerLeave={composeHandlers(
        composeHandlers(onPointerLeave, longPress.onPointerLeave),
        () => setHovered(false),
      )}
    >
      {content}
    </div>
  );
  return (
    <RadixContextMenuTrigger asChild disabled={!enabled || !enabledOnWeb}>
      {element}
    </RadixContextMenuTrigger>
  );
}
