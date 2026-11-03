// Port of archive/expo-app:packages/app/src/components/ui/context-menu.tsx: the right-click shape of the menu
// engine. The trigger is the element itself (a tab chip, a row), so it renders a div that Radix
// opens the menu from. On a phone the menu is a bottom sheet, opened by the context gesture or a
// held touch (iOS Safari sends no contextmenu event).
import {
  useCallback,
  useMemo,
  useState,
  type MouseEvent,
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

/**
 * Context menus use the mobile menu convention by default: long press opens a bottom sheet on a
 * compact layout, while right click opens an anchored popover on a wide layout.
 */
export function ContextMenu({
  compactMode = "sheet",
  ...props
}: ComponentProps<typeof MenuRoot>): ReactElement {
  return <MenuRoot {...props} compactMode={compactMode} kind="context" />;
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

/**
 * On a phone the sheet is not a Radix menu, so the trigger opens it from the context gesture or a
 * held touch. The Expo app's trigger forwards a long press too (a row selects itself).
 */
function useSheetTrigger({
  isSheet,
  isEnabled,
  setOpen,
  style,
  onLongPress,
  longPressDelayMs,
}: {
  isSheet: boolean;
  isEnabled: boolean;
  setOpen: (open: boolean) => void;
  style: ContextMenuTriggerProps["style"];
  onLongPress: (() => void) | undefined;
  longPressDelayMs: number | undefined;
}) {
  // iOS Safari sends no contextmenu event, so a held touch is the only way to the sheet there.
  const handleLongPress = useCallback(
    (pointerType: string) => {
      onLongPress?.();
      if (isSheet && isEnabled && pointerType === "touch") setOpen(true);
    },
    [isEnabled, isSheet, onLongPress, setOpen],
  );
  const longPress = useLongPress(
    onLongPress || isSheet ? handleLongPress : undefined,
    longPressDelayMs,
  );
  const triggerStyle = useMemo<CSSProperties | undefined>(() => {
    const base = typeof style === "object" ? style : undefined;
    // A long press on a phone opens the sheet, not the browser's link/image callout.
    return isSheet ? { ...base, WebkitTouchCallout: "none" } : base;
  }, [isSheet, style]);
  const handleSheetContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      // A trigger inside this one (a row in a list) already opened its own menu.
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (isEnabled) setOpen(true);
    },
    [isEnabled, setOpen],
  );
  return {
    triggerStyle,
    onContextMenu: isSheet ? handleSheetContextMenu : undefined,
    longPress,
  };
}

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
  const { open, setOpen, presentation } = useMenuContext("ContextMenuTrigger");
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
  const isSheet = presentation === "sheet";
  const { triggerStyle, onContextMenu, longPress } = useSheetTrigger({
    isSheet,
    isEnabled: enabled && enabledOnWeb && !disabled,
    setOpen,
    style,
    onLongPress,
    longPressDelayMs,
  });
  const element = (
    <div
      {...props}
      ref={mergeRefs(ref, triggerRef)}
      role={accessibilityRole === "button" || pressable ? "button" : undefined}
      tabIndex={pressable ? 0 : undefined}
      aria-label={accessibilityLabel}
      aria-disabled={disabled || undefined}
      data-testid={testID}
      style={triggerStyle}
      onContextMenu={composeHandlers(onContextMenuProp, onContextMenu)}
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
  if (isSheet) return element;
  return (
    <RadixContextMenuTrigger asChild disabled={!enabled || !enabledOnWeb}>
      {element}
    </RadixContextMenuTrigger>
  );
}
