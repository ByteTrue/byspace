// Port of archive/expo-app:packages/app/src/components/headers/header-toggle-button.tsx: a large header icon
// button (28px, 32px on a phone) with a tooltip naming it and its shortcut.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { iconButtonChromeClassName } from "@/components/ui/icon-button-chrome";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutKey } from "@/utils/format-shortcut";

interface HeaderToggleButtonState {
  hovered: boolean;
  pressed: boolean;
}

interface HeaderToggleButtonProps {
  onPress: () => void;
  tooltipLabel: string;
  tooltipKeys: ShortcutKey[];
  tooltipSide: "left" | "right" | "top" | "bottom";
  tooltipDelayDuration?: number;
  style?: unknown;
  disabled?: boolean;
  testID?: string;
  accessible?: boolean;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { expanded?: boolean };
  children: ReactNode | ((state: HeaderToggleButtonState) => ReactNode);
}

export function HeaderToggleButton({
  onPress,
  tooltipLabel,
  tooltipKeys,
  tooltipSide,
  tooltipDelayDuration = 0,
  style,
  disabled,
  testID,
  accessibilityLabel,
  accessibilityState,
  children,
}: HeaderToggleButtonProps): ReactElement {
  const expanded = accessibilityState?.expanded;
  return (
    <Tooltip delayDuration={tooltipDelayDuration} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        aria-expanded={typeof expanded === "boolean" ? expanded : undefined}
        disabled={disabled}
        onPress={onPress}
        className={iconButtonChromeClassName({ size: "large", disabled })}
        style={
          style && typeof style === "object" && !Array.isArray(style)
            ? (style as CSSProperties)
            : undefined
        }
      >
        {typeof children === "function" ? children({ hovered: false, pressed: false }) : children}
      </TooltipTrigger>
      <TooltipContent
        testID={testID ? `${testID}-tooltip` : undefined}
        side={tooltipSide}
        offset={8}
      >
        <span className="flex items-center gap-2">
          {tooltipLabel}
          <Shortcut keys={tooltipKeys} />
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The large header button's frame, for slots that reserve its place. */
export const headerIconSlotStyle = {
  slot: { width: 28, height: 28 },
};
