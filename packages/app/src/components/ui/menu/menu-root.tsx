import {
  forwardRef,
  useCallback,
  useState,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
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
  MenuContextProvider,
  useMenuContext,
  useMenuState,
  type MenuCompactMode,
} from "./menu-context";

/** Owns one menu's state. Wrap a trigger and a `MenuSurface` in it. */
export function MenuRoot({
  open,
  defaultOpen,
  onOpenChange,
  compactMode,
  children,
}: PropsWithChildren<{
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  compactMode?: MenuCompactMode;
}>): ReactElement {
  const value = useMenuState({ open, defaultOpen, onOpenChange, compactMode });
  return <MenuContextProvider value={value}>{children}</MenuContextProvider>;
}

export interface MenuTriggerState {
  pressed: boolean;
  hovered: boolean;
  open: boolean;
}

type TriggerStyleProp = StyleProp<ViewStyle> | ((state: MenuTriggerState) => StyleProp<ViewStyle>);

export interface MenuTriggerProps extends Omit<PressableProps, "style" | "children"> {
  style?: TriggerStyleProp;
  children: ReactNode | ((state: MenuTriggerState) => ReactNode);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  Object.assign(ref, { current: value });
}

/** Canonical Browser hover ownership: a plain View wraps the inner Pressable. */
export const MenuTrigger = forwardRef<View, MenuTriggerProps>(function MenuTrigger(
  { children, disabled, style, ...props },
  forwardedRef,
): ReactElement {
  const ctx = useMenuContext("MenuTrigger");
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const handleTriggerRef = useCallback(
    (node: View | null) => {
      assignRef(ctx.triggerRef, node);
      assignRef(forwardedRef, node);
    },
    [ctx.triggerRef, forwardedRef],
  );

  const handlePress = useCallback(() => {
    if (disabled) return;
    ctx.setOpen(!ctx.open);
  }, [disabled, ctx]);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => {
      if (typeof style === "function") {
        return style({ pressed, hovered, open: ctx.open });
      }
      return style;
    },
    [style, hovered, ctx.open],
  );

  const renderChildren = useCallback(
    ({ pressed }: PressableStateCallbackType) => {
      const state: MenuTriggerState = { pressed, hovered, open: ctx.open };
      return typeof children === "function" ? children(state) : children;
    },
    [children, hovered, ctx.open],
  );

  return (
    <View
      ref={handleTriggerRef}
      collapsable={false}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable {...props} disabled={disabled} onPress={handlePress} style={pressableStyle}>
        {renderChildren}
      </Pressable>
    </View>
  );
});
