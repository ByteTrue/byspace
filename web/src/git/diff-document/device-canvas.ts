// Sizing the diff canvases so the browser shows their bitmaps 1:1.
//
// At a fractional zoom (125% and 150% are the Windows defaults) a canvas whose bitmap is
// ceil(cssSize * devicePixelRatio) is not the size the browser paints it into: 778 CSS px at 1.25
// is 972.5 device px while the bitmap has 973 rows. The browser then resamples the whole bitmap
// and every glyph in the diff goes soft. Layout also keeps lengths in 1/64 CSS px, so a size like
// 790.4px is stored as 790.390625px, which is still resampled. A canvas whose CSS size is a whole
// number of device pixels and exact in layout units is shown 1:1, wherever it sits.

const LAYOUT_UNIT = 64;

function isExactInLayout(pixels: number, ratio: number): boolean {
  const units = (pixels / ratio) * LAYOUT_UNIT;
  return Math.abs(units - Math.round(units)) < 1e-6;
}

/**
 * The bitmap size, in device pixels, for a canvas that has to cover `css` CSS pixels: the smallest
 * one at or above `css * ratio` whose CSS size layout stores exactly. At 125% and 175% that is a
 * multiple of 4 CSS px, at 150% of 2, so the canvas overhangs by at most 4 CSS px and its container
 * clips the rest. A ratio with no exact size nearby (Chrome reports some zoom levels as float32)
 * gets the covering size, which the browser resamples as before.
 */
export function deviceCanvasPixels(css: number, ratio: number): number {
  const least = Math.max(1, Math.ceil(css * ratio - 1e-6));
  for (let pixels = least; pixels < least + LAYOUT_UNIT; pixels += 1) {
    if (isExactInLayout(pixels, ratio)) return pixels;
  }
  return least;
}

/**
 * An opaque 2D context. Chrome draws canvas text with subpixel (ClearType) smoothing only on an
 * opaque canvas; on a transparent one it falls back to grayscale smoothing, which reads blurrier
 * than the DOM text around it. Every pixel of an opaque canvas has to be painted: a cleared or
 * freshly resized one is black.
 */
export function opaqueContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d", { alpha: false });
}

/** Paints every pixel of an opaque canvas one color. */
export function fillCanvas(context: CanvasRenderingContext2D, color: string): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = color;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
}

/** Rounds a coordinate to the device pixel grid, so a text baseline lands on a pixel boundary. */
export function snapToDevicePixel(value: number, ratio: number): number {
  return Math.round(value * ratio) / ratio;
}
