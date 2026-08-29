import {
  useCallback,
  useState,
  type ComponentProps,
  type PropsWithChildren,
  type ReactElement,
  type Ref,
} from "react";
import {
  Pressable,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  MenuHint,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuSurface,
  useMenuContext,
  type MenuSurfaceProps,
  type MenuTriggerState,
} from "@/components/ui/menu";

/**
 * A menu opened by a browser context-menu gesture, anchored to the gesture point.
 *
 * Everything below the trigger is the shared menu engine — see `@/components/ui/menu` and
 * docs/menus.md. Only the way it opens differs from `dropdown-menu.tsx`.
 */

export { MenuItem as ContextMenuItem };
export { MenuLabel as ContextMenuLabel };
export { MenuSeparator as ContextMenuSeparator };
export { MenuHint as ContextMenuHint };
export type { ActionStatus } from "@/components/ui/menu";

/** Uses a bottom sheet on compact browser viewports and an anchored popover on wide viewports. */
export function ContextMenu({
  compactMode = "sheet",
  ...props
}: ComponentProps<typeof MenuRoot>): ReactElement {
  return <MenuRoot {...props} compactMode={compactMode} />;
}

export function ContextMenuContent(props: MenuSurfaceProps): ReactElement | null {
  return <MenuSurface {...props} />;
}

export function useContextMenu() {
  return useMenuContext("useContextMenu");
}

function isCallable(fn: unknown): fn is (...args: unknown[]) => void {
  return typeof fn === "function";
}

function coerceEventPoint(event: unknown): { pageX: number; pageY: number } | null {
  if (typeof event !== "object" || event === null) return null;

  const nativeEvent = Reflect.get(event, "nativeEvent");
  const source = typeof nativeEvent === "object" && nativeEvent !== null ? nativeEvent : event;
  const pageX = Reflect.get(source, "pageX");
  const pageY = Reflect.get(source, "pageY");
  if (typeof pageX === "number" && typeof pageY === "number") {
    return { pageX, pageY };
  }

  const clientX = Reflect.get(source, "clientX");
  const clientY = Reflect.get(source, "clientY");
  if (typeof clientX === "number" && typeof clientY === "number") {
    return { pageX: clientX, pageY: clientY };
  }
  return null;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as { current: T }).current = value;
}

type TriggerStyleProp = StyleProp<ViewStyle> | ((state: MenuTriggerState) => StyleProp<ViewStyle>);

export function ContextMenuTrigger({
  children,
  disabled,
  highlightStyle: _highlightStyle,
  style,
  enabled = true,
  enabledOnMobile: _enabledOnMobile = true,
  enabledOnWeb = true,
  longPressDelayMs,
  onContextMenu,
  triggerRef,
  ...props
}: PropsWithChildren<
  Omit<PressableProps, "style"> & {
    /** Retained for call-site compatibility; Browser triggers use the regular pressed style. */
    highlightStyle?: StyleProp<ViewStyle>;
    style?: TriggerStyleProp;
    enabled?: boolean;
    enabledOnMobile?: boolean;
    enabledOnWeb?: boolean;
    longPressDelayMs?: number;
    onContextMenu?: (event: unknown) => void;
    triggerRef?: Ref<View | null>;
  }
>): ReactElement {
  const ctx = useMenuContext("ContextMenuTrigger");
  const [hovered, setHovered] = useState(false);
  const shouldEnable = enabled && enabledOnWeb;

  const openAtEvent = useCallback(
    (event: unknown) => {
      if (!shouldEnable || disabled) return;
      const point = coerceEventPoint(event);
      if (!point) return;

      ctx.setAnchorRect({ x: point.pageX, y: point.pageY, width: 0, height: 0 });
      ctx.setOpen(true);
    },
    [ctx, disabled, shouldEnable],
  );

  const handleRef = useCallback(
    (node: View | null) => {
      assignRef(ctx.triggerRef, node);
      assignRef(triggerRef, node);
    },
    [ctx.triggerRef, triggerRef],
  );

  const handleContextMenu = useCallback(
    (event: unknown) => {
      if (typeof event === "object" && event !== null) {
        const preventDefault = Reflect.get(event, "preventDefault");
        const stopPropagation = Reflect.get(event, "stopPropagation");
        if (isCallable(preventDefault)) preventDefault.call(event);
        if (isCallable(stopPropagation)) stopPropagation.call(event);
      }
      onContextMenu?.(event);
      openAtEvent(event);
    },
    [onContextMenu, openAtEvent],
  );
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => {
      if (typeof style === "function") {
        return style({ pressed, hovered, open: ctx.open });
      }
      return style;
    },
    [style, hovered, ctx.open],
  );

  return (
    <View
      ref={handleRef}
      collapsable={false}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      // @ts-ignore - onContextMenu is a browser event and is not in RN's View types.
      onContextMenu={handleContextMenu}
    >
      <Pressable
        {...props}
        disabled={disabled}
        delayLongPress={longPressDelayMs}
        style={typeof style === "function" ? pressableStyle : style}
      >
        {children}
      </Pressable>
    </View>
  );
}
