// Override of packages/app/src/components/ui/button.tsx on shadcn's Button. Same props; `size`
// md is shadcn's default (32px) and the variants map one to one.
import {
  useCallback,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button as ShadButton } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "xs" | "sm" | "md" | "lg";
type LeftIcon =
  | ReactElement
  | ComponentType<{ color: string; size: number }>
  | ((color: string) => ReactElement)
  | null;

const SIZE = { xs: "xs", sm: "sm", md: "default", lg: "lg" } as const;
const ICON_SIZE: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 16, lg: 16 };

function renderLeftIcon(leftIcon: LeftIcon | undefined, size: number): ReactNode {
  if (!leftIcon) return null;
  if (typeof leftIcon === "object") return leftIcon;
  const fn = leftIcon as (color: string) => ReactElement;
  if (
    !(leftIcon as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent &&
    fn.length > 0
  ) {
    return fn("currentColor");
  }
  const Icon = leftIcon as ComponentType<{ color: string; size: number }>;
  return <Icon color="currentColor" size={size} />;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  leftIcon,
  trailing,
  style,
  textStyle: _textStyle,
  className,
  disabled,
  loading = false,
  onPress,
  onClick,
  testID,
  accessibilityLabel,
  accessibilityRole: _accessibilityRole,
  accessibilityState: _accessibilityState,
  accessibilityHint: _accessibilityHint,
  type = "button",
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<"button">, "style"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: LeftIcon;
    trailing?: ReactNode;
    style?: CSSProperties | unknown;
    textStyle?: unknown;
    loading?: boolean;
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: unknown;
    accessibilityHint?: string;
  }
>) {
  // A wrapping Slot (a tooltip trigger) passes its own onClick; both run.
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      onPress?.();
    },
    [onClick, onPress],
  );
  return (
    <ShadButton
      variant={variant}
      size={SIZE[size]}
      disabled={disabled || loading}
      data-testid={testID}
      aria-label={accessibilityLabel}
      className={className}
      style={
        style && typeof style === "object" && !Array.isArray(style)
          ? (style as CSSProperties)
          : undefined
      }
      type={type}
      {...props}
      onClick={handleClick}
    >
      {loading ? <Spinner /> : renderLeftIcon(leftIcon, ICON_SIZE[size])}
      {children}
      {trailing}
    </ShadButton>
  );
}
