// Override of packages/app/src/components/ui/context-menu.tsx: the right-click shape of the menu
// engine. The trigger is the element itself (a tab chip, a row), so it renders a div that Radix
// opens the menu from.
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

export function ContextMenu({
  compactMode: _compactMode,
  ...props
}: ComponentProps<typeof MenuRoot>): ReactElement {
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
  longPressDelayMs: _longPressDelayMs,
  onPress,
  onPressIn,
  onLongPress: _onLongPress,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState: _accessibilityState,
  accessibilityHint: _accessibilityHint,
  onClick,
  onPointerDown,
  onKeyDown,
  onPointerEnter,
  onPointerLeave,
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
  return (
    <RadixContextMenuTrigger asChild disabled={!enabled || !enabledOnWeb}>
      <div
        {...props}
        ref={mergeRefs(ref, triggerRef)}
        role={accessibilityRole === "button" || pressable ? "button" : undefined}
        tabIndex={pressable ? 0 : undefined}
        aria-label={accessibilityLabel}
        aria-disabled={disabled || undefined}
        data-testid={testID}
        style={typeof style === "object" ? style : undefined}
        onClick={composeHandlers(onClick, pressable && onPress ? () => onPress() : undefined)}
        onPointerDown={composeHandlers(
          onPointerDown,
          pressable && onPressIn ? (event) => event.button === 0 && onPressIn() : undefined,
        )}
        onKeyDown={composeHandlers(onKeyDown, handleKeyDown)}
        onPointerEnter={composeHandlers(onPointerEnter, () => setHovered(true))}
        onPointerLeave={composeHandlers(onPointerLeave, () => setHovered(false))}
      >
        {content}
      </div>
    </RadixContextMenuTrigger>
  );
}
