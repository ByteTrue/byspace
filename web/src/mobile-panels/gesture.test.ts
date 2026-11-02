import { describe, expect, it } from "vitest";
import { cubicBezier, mobilePanelGestureEndTarget, mobilePanelGesturePosition } from "./gesture";

describe("mobile panel gestures", () => {
  it("maps a drag onto the panel position", () => {
    expect(mobilePanelGesturePosition("open-left", 195, 390)).toBe(-0.5);
    expect(mobilePanelGesturePosition("open-right", -195, 390)).toBe(0.5);
    expect(mobilePanelGesturePosition("close-left", -195, 390)).toBe(-0.5);
    expect(mobilePanelGesturePosition("close-right", 195, 390)).toBe(0.5);
  });

  it("settles past a third of the width or on a flick", () => {
    expect(mobilePanelGestureEndTarget("open-left", 131, 0, 390)).toBe("agent-list");
    expect(mobilePanelGestureEndTarget("open-left", 129, 0, 390)).toBe("agent");
    expect(mobilePanelGestureEndTarget("open-left", 40, 600, 390)).toBe("agent-list");
    expect(mobilePanelGestureEndTarget("close-left", -131, 0, 390)).toBe("agent");
    expect(mobilePanelGestureEndTarget("close-left", -40, -200, 390)).toBe("agent-list");
    expect(mobilePanelGestureEndTarget("open-right", -40, -600, 390)).toBe("file-explorer");
    expect(mobilePanelGestureEndTarget("open-right", -129, 0, 390)).toBe("agent");
    expect(mobilePanelGestureEndTarget("close-right", 131, 0, 390)).toBe("agent");
    expect(mobilePanelGestureEndTarget("close-right", 40, 499, 390)).toBe("file-explorer");
  });

  it("eases like CSS cubic-bezier(0.25, 0.1, 0.25, 1)", () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // The CSS `ease` curve: ~0.8 at the halfway point, monotonic.
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    let previous = 0;
    for (let x = 0.05; x < 1; x += 0.05) {
      const y = ease(x);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
  });
});
