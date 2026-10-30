import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  default as React,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, Text, View } from "react-native";
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  buttonIconSize,
  createControlGeometry,
  type ButtonControlSize,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = ButtonControlSize;

type LeftIcon =
  | ReactElement
  | ComponentType<{ color: string; size: number }>
  | ((color: string) => ReactElement)
  | null;

interface ButtonIconProps {
  loading: boolean;
  leftIcon?: LeftIcon;
  iconSize: number;
  iconColor: string;
}

function ButtonIcon({ loading, leftIcon, iconSize, iconColor }: ButtonIconProps) {
  if (loading) {
    return (
      <View>
        <LoadingSpinner size="small" color={iconColor} />
      </View>
    );
  }

  if (!leftIcon) return null;

  if (typeof leftIcon === "object" && "type" in leftIcon) {
    return <View>{leftIcon}</View>;
  }

  if (
    typeof leftIcon === "function" &&
    !leftIcon.prototype?.isReactComponent &&
    leftIcon.length > 0
  ) {
    return <View>{(leftIcon as (color: string) => ReactElement)(iconColor)}</View>;
  }

  const Icon = leftIcon as ComponentType<{ color: string; size: number }>;
  return (
    <View>
      <Icon color={iconColor} size={iconSize} />
    </View>
  );
}

const ThemedButtonIcon = withUnistyles(ButtonIcon);

const foregroundIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foreground });
const accentForegroundIconMapping = (theme: Theme) => ({
  iconColor: theme.colors.accentForeground,
});
const destructiveIconMapping = (theme: Theme) => ({
  iconColor: theme.colors.destructive,
});

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    base: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[1.5],
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: "transparent",
    },
    md: {
      ...geometry.buttonMd,
    },
    xs: {
      ...geometry.buttonXs,
    },
    sm: {
      ...geometry.buttonSm,
    },
    lg: {
      ...geometry.buttonLg,
    },
    // shadcn/ui button variants: each one owns its rest and hover fill.
    default: {
      backgroundColor: theme.colors.accent,
    },
    defaultHovered: {
      backgroundColor: theme.colors.accentHover,
    },
    secondary: {
      backgroundColor: theme.colors.surface2,
    },
    secondaryHovered: {
      backgroundColor: theme.colors.surface3,
    },
    outline: {
      backgroundColor: theme.colors.controlFill,
      borderColor: theme.colors.borderAccent,
    },
    outlineHovered: {
      backgroundColor: theme.colors.controlFillHover,
    },
    ghost: {
      backgroundColor: "transparent",
    },
    ghostHovered: {
      backgroundColor: theme.colors.interactionHighlight,
    },
    destructive: {
      backgroundColor: theme.colors.destructiveSoft,
    },
    destructiveHovered: {
      backgroundColor: theme.colors.destructiveSoftHover,
    },
    // The press sinks the button a pixel instead of fading it.
    pressed: {
      transform: [{ translateY: 1 }],
    },
    disabled: {
      opacity: theme.opacity[50],
    },
    text: {
      color: theme.colors.foreground,
      ...geometry.buttonText,
      fontWeight: theme.fontWeight.medium,
    },
    textXs: {
      ...geometry.buttonTextXs,
    },
    textDefault: {
      color: theme.colors.accentForeground,
    },
    textDestructive: {
      color: theme.colors.destructive,
    },
  };
});

export function Button({
  children,
  variant = "secondary",
  size = "md",
  leftIcon,
  trailing,
  style,
  textStyle,
  disabled,
  loading = false,
  accessibilityRole,
  accessibilityState: accessibilityStateProp,
  ...props
}: PropsWithChildren<
  Omit<PressableProps, "style"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: LeftIcon;
    trailing?: ReactNode;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    loading?: boolean;
  }
>) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = disabled || loading;

  let variantStyle: ViewStyle;
  let variantHoveredStyle: ViewStyle;
  if (variant === "default") {
    variantStyle = styles.default;
    variantHoveredStyle = styles.defaultHovered;
  } else if (variant === "secondary") {
    variantStyle = styles.secondary;
    variantHoveredStyle = styles.secondaryHovered;
  } else if (variant === "outline") {
    variantStyle = styles.outline;
    variantHoveredStyle = styles.outlineHovered;
  } else if (variant === "ghost") {
    variantStyle = styles.ghost;
    variantHoveredStyle = styles.ghostHovered;
  } else {
    variantStyle = styles.destructive;
    variantHoveredStyle = styles.destructiveHovered;
  }

  let sizeStyle: ViewStyle;
  if (size === "xs") {
    sizeStyle = styles.xs;
  } else if (size === "sm") {
    sizeStyle = styles.sm;
  } else if (size === "lg") {
    sizeStyle = styles.lg;
  } else {
    sizeStyle = styles.md;
  }

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
      styles.base,
      sizeStyle,
      variantStyle,
      hovered && !isDisabled ? variantHoveredStyle : null,
      pressed && !isDisabled ? styles.pressed : null,
      isDisabled ? styles.disabled : null,
      style,
    ],
    [sizeStyle, variantStyle, variantHoveredStyle, hovered, isDisabled, style],
  );

  const resolvedTextStyle = useMemo(
    () => [
      styles.text,
      size === "xs" ? styles.textXs : null,
      variant === "default" ? styles.textDefault : null,
      variant === "destructive" ? styles.textDestructive : null,
      textStyle,
    ],
    [size, variant, textStyle],
  );

  const accessibilityState = useMemo(
    () => ({ ...accessibilityStateProp, disabled: isDisabled, busy: loading }),
    [accessibilityStateProp, isDisabled, loading],
  );

  function resolveIconMapping() {
    if (variant === "default") {
      return accentForegroundIconMapping;
    }
    if (variant === "destructive") {
      return destructiveIconMapping;
    }
    return foregroundIconMapping;
  }

  return (
    <Pressable
      {...props}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityState={accessibilityState}
      disabled={isDisabled}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableStyle}
    >
      <ThemedButtonIcon
        loading={loading}
        leftIcon={leftIcon}
        iconSize={buttonIconSize[size]}
        uniProps={resolveIconMapping()}
      />
      {children != null ? <Text style={resolvedTextStyle}>{children}</Text> : null}
      {trailing}
    </Pressable>
  );
}
