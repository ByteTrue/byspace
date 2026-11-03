// Port of archive/expo-app:packages/app/src/composer/agent-controls/control.tsx: the trigger every composer
// control uses — a 28px toolbar chip (icon, value, optional caret), or a 44px sheet row (icon,
// label, value) in the phone's controls sheet.
import { forwardRef, type ComponentProps } from "react";
import type { AgentControlIcon } from "@/agent-controls/icons";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { cn } from "cn";

type AgentControlTriggerProps = Omit<
  ComponentProps<typeof ComboboxTrigger>,
  "accessibilityLabel" | "block" | "children" | "chevron" | "onPress"
> & {
  icon: AgentControlIcon;
  iconColor?: string;
  surface: "toolbar" | "sheet";
  label: string;
  value?: string;
  showToolbarLabel?: boolean;
  showCaret?: boolean;
  open?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
};

/** A 44px row in the phone's controls sheet, or a 28px chip (icon only when there is no room). */
function triggerClassName({
  isSheet,
  className,
}: {
  isSheet: boolean;
  className: string | undefined;
}): string {
  return cn(isSheet ? "w-full" : "shrink", className);
}

function triggerSize(isSheet: boolean, showToolbarLabel: boolean): "lg" | "sm" | "icon-sm" {
  if (isSheet) return "lg";
  return showToolbarLabel ? "sm" : "icon-sm";
}

export const AgentControlTrigger = forwardRef<HTMLButtonElement, AgentControlTriggerProps>(
  function AgentControlTrigger(
    {
      icon: Icon,
      iconColor,
      surface,
      label,
      value,
      showToolbarLabel = true,
      showCaret = false,
      open = false,
      disabled = false,
      onPress,
      accessibilityLabel,
      testID,
      className,
      ...triggerProps
    },
    ref,
  ) {
    const { glyphSize } = useComposerControlLayout();
    const isSheet = surface === "sheet";
    const resolvedGlyphSize = isSheet ? 16 : glyphSize;
    const showValue = isSheet || showToolbarLabel;
    const icon = (
      <span className={cn("flex", iconColor ? undefined : "text-muted-foreground")}>
        <Icon size={resolvedGlyphSize} color={iconColor ?? "currentColor"} />
      </span>
    );
    return (
      <ComboboxTrigger
        {...triggerProps}
        ref={ref}
        disabled={disabled}
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        aria-expanded={open}
        testID={testID}
        chevron={showCaret ? undefined : null}
        // On a phone the controls are a sheet's rows; in the composer toolbar, ghost buttons.
        variant={isSheet ? "secondary" : "ghost"}
        size={triggerSize(isSheet, showToolbarLabel)}
        className={triggerClassName({ isSheet, className })}
      >
        {isSheet ? (
          <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
        ) : (
          <ComposerToolbarGlyph size={resolvedGlyphSize}>{icon}</ComposerToolbarGlyph>
        )}
        {isSheet ? (
          <span className="min-w-0 flex-1 truncate text-left text-sm text-foreground">{label}</span>
        ) : null}
        {showValue ? (
          <span
            className={cn(
              "min-w-0 shrink truncate text-sm text-muted-foreground",
              isSheet && "max-w-[45%]",
            )}
          >
            {value ?? label}
          </span>
        ) : null}
      </ComboboxTrigger>
    );
  },
);
