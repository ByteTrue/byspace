import { describe, expect, it } from "vitest";
import {
  buttonControlHeight,
  createControlGeometry,
  DESKTOP_CONTROL_HEIGHTS,
  getControlInteractionPhase,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

const theme = {
  borderRadius: {
    base: 6,
    md: 8,
    lg: 10,
    xl: 14,
    full: 9999,
  },
  borderWidth: {
    1: 1,
  },
  colors: {
    borderAccent: "#e5e5e5",
    ring: "#a1a1a1",
    focusRing: "rgba(161, 161, 161, 0.5)",
  },
  fontSize: {
    xs: 10,
    sm: 12,
    base: 14,
  },
  opacity: {
    50: 0.5,
  },
  spacing: {
    0: 0,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    4: 16,
    6: 24,
  },
} as unknown as Theme;

describe("control geometry", () => {
  it("draws the input border at rest and the shadcn focus ring when active", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.controlRest).toEqual({
      borderWidth: 1,
      borderColor: "#e5e5e5",
      outlineColor: "transparent",
      outlineWidth: 0,
    });
    expect(geometry.controlActive).toEqual({
      borderColor: "#a1a1a1",
      outlineColor: "rgba(161, 161, 161, 0.5)",
      outlineOffset: 0,
      outlineStyle: "solid",
      outlineWidth: 3,
    });
  });

  it("resolves disabled, focus, open, pressed, and hover into one interaction phase", () => {
    expect(getControlInteractionPhase({ disabled: true, focused: true })).toBe("rest");
    expect(getControlInteractionPhase({ focused: true })).toBe("active");
    expect(getControlInteractionPhase({ open: true })).toBe("active");
    expect(getControlInteractionPhase({ pressed: true })).toBe("active");
    expect(getControlInteractionPhase({ hovered: true })).toBe("hover");
    expect(getControlInteractionPhase({})).toBe("rest");
  });

  it("keeps field text sizing tied to control size", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.fieldTextSm).toEqual({ fontSize: 14, lineHeight: 20 });
    expect(geometry.fieldTextMd).toEqual({ fontSize: 14, lineHeight: 20 });
    expect(geometry.formTextInputSm.fontSize).toBe(14);
    expect(geometry.formTextInputMd.lineHeight).toBe(20);
  });

  it("derives field padding from content and border at both breakpoints", () => {
    const geometry = createControlGeometry(theme);
    const border = theme.borderWidth[1];

    expect(geometry.fieldControlSm.minHeight).toEqual({ xs: 32, md: 28 });
    expect(geometry.fieldControlMd.minHeight).toEqual({ xs: 44, md: 32 });
    for (const control of [geometry.fieldControlSm, geometry.fieldControlMd]) {
      for (const breakpoint of ["xs", "md"] as const) {
        expect(
          geometry.fieldTextSm.lineHeight + control.paddingVertical[breakpoint] * 2 + border * 2,
        ).toBe(control.minHeight[breakpoint]);
      }
    }
  });

  it("uses shadcn nova heights on desktop and touch heights on compact", () => {
    const geometry = createControlGeometry(theme);

    expect(DESKTOP_CONTROL_HEIGHTS).toEqual({ xs: 24, sm: 28, md: 32, lg: 36 });
    expect(geometry.buttonXs.minHeight).toEqual({ xs: buttonControlHeight.xs, md: 24 });
    expect(geometry.buttonSm.minHeight).toEqual({ xs: buttonControlHeight.sm, md: 28 });
    expect(geometry.buttonMd.minHeight).toEqual({ xs: buttonControlHeight.md, md: 32 });
    expect(geometry.buttonLg.minHeight).toEqual({ xs: buttonControlHeight.lg, md: 36 });
  });

  it("sizes a segmented track like the button of the same size, with inset segments", () => {
    const geometry = createControlGeometry(theme);
    const sizes = [
      [geometry.segmentedContainerXs, geometry.segmentedSegmentXs, geometry.buttonXs],
      [geometry.segmentedContainerSm, geometry.segmentedSegmentSm, geometry.buttonSm],
      [geometry.segmentedContainerMd, geometry.segmentedSegmentMd, geometry.buttonMd],
    ] as const;

    for (const [container, segment, button] of sizes) {
      expect(container.minHeight).toEqual(button.minHeight);
      for (const breakpoint of ["xs", "md"] as const) {
        expect(segment.minHeight[breakpoint]).toBe(
          container.minHeight[breakpoint] - container.padding * 2,
        );
      }
      // The selected segment nests inside the track, so its corner is one step tighter.
      expect(segment.borderRadius).toBeLessThan(container.borderRadius);
    }

    // Same size name means the same label size on every control kind.
    expect(geometry.segmentedLabelXs.fontSize).toBe(geometry.buttonTextXs.fontSize);
    expect(geometry.segmentedLabelSm.fontSize).toBe(geometry.buttonText.fontSize);
    expect(geometry.segmentedLabelMd.fontSize).toBe(geometry.buttonText.fontSize);
  });
});
