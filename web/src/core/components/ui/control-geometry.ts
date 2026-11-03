import { ICON_SIZE, type Theme } from "@/styles/theme";

export type ButtonControlSize = "xs" | "sm" | "md" | "lg";
export type FieldControlSize = "sm" | "md";
export type SegmentedControlSize = "xs" | "sm" | "md";
export type ControlInteractionPhase = "rest" | "hover" | "active";

export interface ControlInteractionState {
  hovered?: boolean;
  focused?: boolean;
  pressed?: boolean;
  open?: boolean;
  active?: boolean;
  disabled?: boolean;
}

const TIGHT_CONTROL_HEIGHT = 28;
const COMPACT_CONTROL_HEIGHT = 32;
const FIELD_CONTROL_HEIGHT = 44;
export const HEADER_CONTROL_HEIGHT = 28;
const SEGMENTED_TIGHT_INSET = 2;
const SEGMENTED_INSET = 3;
// shadcn/ui switch: 32 x 18.4 track behind a 1px transparent border, 16px thumb.
const SWITCH_TRACK_WIDTH = 32;
const SWITCH_TRACK_HEIGHT = 18;
const SWITCH_THUMB_SIZE = 16;
const CONTROL_FOCUS_RING_WIDTH = 3;
const CONTROL_FOCUS_RING_OFFSET = 0;
const CONTROL_CENTER_JUSTIFY_CONTENT = "center";
const FIELD_TEXT_LINE_HEIGHT_RATIO = 1.4;

/**
 * The three control heights every button, field, and segmented control is built from.
 * Exported so a row that hosts one of those controls can size itself from the same
 * numbers instead of guessing a height the control then outgrows.
 */
export const CONTROL_HEIGHTS = {
  tight: TIGHT_CONTROL_HEIGHT,
  compact: COMPACT_CONTROL_HEIGHT,
  field: FIELD_CONTROL_HEIGHT,
};

/**
 * From the `md` breakpoint up, buttons, fields and segmented controls take shadcn/ui's
 * nova heights (24 / 28 / 32 / 36). Below it the touch-sized CONTROL_HEIGHTS stay, so a
 * control on a phone keeps a finger-sized target. `buttonControlHeight` and
 * CONTROL_HEIGHTS remain the compact numbers for callers that size against them.
 */
export const DESKTOP_CONTROL_HEIGHTS: Record<ButtonControlSize, number> = {
  xs: 24,
  sm: 28,
  md: 32,
  lg: 36,
};

function responsive<T>(compact: T, desktop: T): { xs: T; md: T } {
  return { xs: compact, md: desktop };
}

export const buttonControlHeight: Record<ButtonControlSize, number> = {
  xs: CONTROL_HEIGHTS.tight,
  sm: CONTROL_HEIGHTS.compact,
  md: CONTROL_HEIGHTS.field,
  lg: CONTROL_HEIGHTS.field,
};

export const buttonIconSize: Record<ButtonControlSize, number> = {
  xs: ICON_SIZE.xs,
  sm: ICON_SIZE.sm,
  md: ICON_SIZE.md,
  lg: ICON_SIZE.lg,
};

export const segmentedIconSize: Record<SegmentedControlSize, number> = {
  xs: ICON_SIZE.xs,
  sm: ICON_SIZE.sm,
  md: ICON_SIZE.md,
};

export const switchGeometry = {
  trackWidth: SWITCH_TRACK_WIDTH,
  trackHeight: SWITCH_TRACK_HEIGHT,
  thumbSize: SWITCH_THUMB_SIZE,
  thumbTravel: SWITCH_TRACK_WIDTH - SWITCH_THUMB_SIZE - (SWITCH_TRACK_HEIGHT - SWITCH_THUMB_SIZE),
};

function fieldLineHeight(fontSize: number): number {
  return Math.round(fontSize * FIELD_TEXT_LINE_HEIGHT_RATIO);
}

function fieldVerticalPadding(
  controlHeight: number,
  lineHeight: number,
  borderWidth: number,
): number {
  return (controlHeight - lineHeight - borderWidth * 2) / 2;
}

export function getControlInteractionPhase(
  state: ControlInteractionState,
): ControlInteractionPhase {
  if (state.disabled) {
    return "rest";
  }
  if (state.active || state.focused || state.open || state.pressed) {
    return "active";
  }
  if (state.hovered) {
    return "hover";
  }
  return "rest";
}

export function createControlGeometry(theme: Theme) {
  const controlBorderWidth = theme.borderWidth[1];
  const fieldTextSmLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldTextMdLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldControlSm = {
    minHeight: responsive(CONTROL_HEIGHTS.compact, DESKTOP_CONTROL_HEIGHTS.sm),
    paddingHorizontal: theme.spacing[2.5],
    paddingVertical: responsive(
      fieldVerticalPadding(CONTROL_HEIGHTS.compact, fieldTextSmLineHeight, controlBorderWidth),
      fieldVerticalPadding(DESKTOP_CONTROL_HEIGHTS.sm, fieldTextSmLineHeight, controlBorderWidth),
    ),
    borderRadius: theme.borderRadius.md,
  };
  const fieldControlMd = {
    minHeight: responsive(CONTROL_HEIGHTS.field, DESKTOP_CONTROL_HEIGHTS.md),
    paddingHorizontal: responsive(theme.spacing[3], theme.spacing[2.5]),
    paddingVertical: responsive(
      fieldVerticalPadding(CONTROL_HEIGHTS.field, fieldTextMdLineHeight, controlBorderWidth),
      fieldVerticalPadding(DESKTOP_CONTROL_HEIGHTS.md, fieldTextMdLineHeight, controlBorderWidth),
    ),
    borderRadius: theme.borderRadius.lg,
  };
  const fieldTextSm = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextSmLineHeight,
  };
  const fieldTextMd = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextMdLineHeight,
  };
  const switchControl = {
    minHeight: responsive(CONTROL_HEIGHTS.compact, DESKTOP_CONTROL_HEIGHTS.sm),
    justifyContent: CONTROL_CENTER_JUSTIFY_CONTENT,
  } satisfies { minHeight: { xs: number; md: number }; justifyContent: "center" };

  return {
    buttonXs: {
      minHeight: responsive(buttonControlHeight.xs, DESKTOP_CONTROL_HEIGHTS.xs),
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
    },
    buttonSm: {
      minHeight: responsive(buttonControlHeight.sm, DESKTOP_CONTROL_HEIGHTS.sm),
      paddingHorizontal: theme.spacing[2.5],
      borderRadius: theme.borderRadius.md,
    },
    buttonMd: {
      minHeight: responsive(buttonControlHeight.md, DESKTOP_CONTROL_HEIGHTS.md),
      paddingHorizontal: responsive(theme.spacing[4], theme.spacing[2.5]),
      borderRadius: theme.borderRadius.lg,
    },
    buttonLg: {
      minHeight: responsive(buttonControlHeight.lg, DESKTOP_CONTROL_HEIGHTS.lg),
      paddingHorizontal: responsive(theme.spacing[6], theme.spacing[3]),
      borderRadius: theme.borderRadius.lg,
    },
    buttonText: {
      fontSize: theme.fontSize.base,
    },
    buttonTextXs: {
      fontSize: theme.fontSize.sm,
    },
    formTextInputSm: {
      ...fieldControlSm,
      ...fieldTextSm,
    },
    formTextInputMd: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    formTextInput: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    fieldControlSm,
    fieldControlMd,
    fieldTextSm,
    fieldTextMd,
    // shadcn/ui field chrome: an input-coloured border at rest; focus turns the border to the
    // ring colour and adds the 3px ring.
    controlRest: {
      borderWidth: controlBorderWidth,
      borderColor: theme.colors.borderAccent,
      outlineWidth: 0,
      outlineColor: "transparent",
    },
    controlHover: {
      borderColor: theme.colors.borderAccent,
    },
    controlActive: {
      borderColor: theme.colors.ring,
      outlineColor: theme.colors.focusRing,
      outlineOffset: CONTROL_FOCUS_RING_OFFSET,
      outlineStyle: "solid" as const,
      outlineWidth: CONTROL_FOCUS_RING_WIDTH,
    },
    controlFocusRingColor: {
      outlineColor: theme.colors.focusRing,
    },
    controlDisabled: {
      opacity: theme.opacity[50],
    },
    switchControl,
    // shadcn/ui tabs list: a muted track, 3px inset (2px at xs), the selected trigger raised.
    segmentedContainerXs: {
      minHeight: responsive(CONTROL_HEIGHTS.tight, DESKTOP_CONTROL_HEIGHTS.xs),
      padding: SEGMENTED_TIGHT_INSET,
      borderRadius: theme.borderRadius.md,
    },
    segmentedContainerSm: {
      minHeight: responsive(CONTROL_HEIGHTS.compact, DESKTOP_CONTROL_HEIGHTS.sm),
      padding: SEGMENTED_INSET,
      borderRadius: theme.borderRadius.lg,
    },
    segmentedContainerMd: {
      minHeight: responsive(CONTROL_HEIGHTS.field, DESKTOP_CONTROL_HEIGHTS.md),
      padding: SEGMENTED_INSET,
      borderRadius: theme.borderRadius.lg,
    },
    segmentedSegmentXs: {
      minHeight: responsive(
        CONTROL_HEIGHTS.tight - SEGMENTED_TIGHT_INSET * 2,
        DESKTOP_CONTROL_HEIGHTS.xs - SEGMENTED_TIGHT_INSET * 2,
      ),
      paddingHorizontal: theme.spacing[1.5],
      borderRadius: theme.borderRadius.base,
    },
    segmentedSegmentSm: {
      minHeight: responsive(
        CONTROL_HEIGHTS.compact - SEGMENTED_INSET * 2,
        DESKTOP_CONTROL_HEIGHTS.sm - SEGMENTED_INSET * 2,
      ),
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
    },
    segmentedSegmentMd: {
      minHeight: responsive(
        CONTROL_HEIGHTS.field - SEGMENTED_INSET * 2,
        DESKTOP_CONTROL_HEIGHTS.md - SEGMENTED_INSET * 2,
      ),
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
    },
    segmentedLabelXs: {
      fontSize: theme.fontSize.sm,
    },
    segmentedLabelSm: {
      fontSize: theme.fontSize.base,
    },
    segmentedLabelMd: {
      fontSize: theme.fontSize.base,
    },
  };
}
