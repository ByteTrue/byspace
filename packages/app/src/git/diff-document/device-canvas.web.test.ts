import { describe, expect, it } from "vitest";
import { deviceCanvasPixels } from "./device-canvas.web";

describe("deviceCanvasPixels", () => {
  it("covers the CSS size with a size the browser shows 1:1", () => {
    // 125%: 791px is 988.75 device px; the next size exact in 1/64 px layout units is 990 (792px).
    expect(deviceCanvasPixels(791, 1.25)).toBe(990);
    expect(deviceCanvasPixels(778, 1.25)).toBe(975);
    expect(deviceCanvasPixels(30, 1.25)).toBe(40);
    expect(deviceCanvasPixels(791, 1.5)).toBe(1188);
    expect(deviceCanvasPixels(791, 2)).toBe(1582);
    expect(deviceCanvasPixels(791, 1)).toBe(791);
  });

  it("never falls short, and overhangs by at most 4 CSS px at the Windows scales", () => {
    const maxOverhang = new Map([
      [1, 1],
      [1.1, 10],
      [1.25, 4],
      [1.5, 2],
      [1.75, 4],
      [2, 1],
      [2.25, 4],
      [3, 1],
    ]);
    for (const [ratio, overhang] of maxOverhang) {
      for (let css = 1; css < 2000; css += 7.3) {
        const pixels = deviceCanvasPixels(css, ratio);
        const cssSize = pixels / ratio;
        expect(pixels).toBeGreaterThanOrEqual(css * ratio - 1e-6);
        expect(cssSize - css).toBeLessThan(overhang + 1e-6);
        // Whole device pixels whose CSS size layout stores exactly.
        expect(Number.isInteger(pixels)).toBe(true);
        expect(Math.abs(cssSize * 64 - Math.round(cssSize * 64))).toBeLessThan(1e-6);
      }
    }
  });

  it("falls back to covering device pixels when no exact size is near", () => {
    // Chrome reports 110% zoom as a float32: no size is exact in layout units.
    expect(deviceCanvasPixels(791, 1.100000023841858)).toBe(871);
  });
});
