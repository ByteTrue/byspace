// Port of archive/expo-app:packages/app/src/components/synced-loader.tsx: the six-dot working glyph. Every
// loader on the page reads one clock (performance time, 950ms per cycle), so they step together;
// a retained, hidden panel's loader stops ticking.
import { useLayoutEffect, useMemo, useRef } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import {
  getSyncedLoaderDotOpacity,
  getSyncedLoaderStep,
  SYNCED_LOADER_DOT_COUNT,
} from "@/components/synced-loader-state";

const GRID_COLUMNS = 2;
const DOT_INDEXES = Array.from({ length: SYNCED_LOADER_DOT_COUNT }, (_, index) => index);

export function SyncedLoader({
  size = 10,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  const active = useRetainedPanelActive();
  const dotsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const dotRefs = useMemo(
    () =>
      DOT_INDEXES.map((dotIndex) => (node: HTMLSpanElement | null) => {
        dotsRef.current[dotIndex] = node;
      }),
    [],
  );
  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    let lastStep = -1;
    const tick = () => {
      const step = getSyncedLoaderStep(Date.now());
      if (step !== lastStep) {
        lastStep = step;
        dotsRef.current.forEach((dot, index) => {
          if (dot) dot.style.opacity = String(getSyncedLoaderDotOpacity(step, index));
        });
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active]);
  // The 2x3 grid fills `size` exactly on its long axis: the dot is whatever is left after the
  // two gaps, not a floored integer, so the glyph never reads as a small mark in a large slot.
  const gap = Math.max(1, Math.round(size * 0.12));
  const dotSize = Math.max(2, (size - gap * 2) / 3);
  const frameStyle = useMemo(() => ({ width: size, height: size }), [size]);
  const gridStyle = useMemo(
    () => ({ width: dotSize * 2 + gap, height: dotSize * 3 + gap * 2 }),
    [dotSize, gap],
  );
  // The opacity here is the first frame's; the clock writes it to the node after that.
  const dotStyles = useMemo(
    () =>
      DOT_INDEXES.map((dotIndex) => ({
        width: dotSize,
        height: dotSize,
        left: (dotIndex % GRID_COLUMNS) * (dotSize + gap),
        top: Math.floor(dotIndex / GRID_COLUMNS) * (dotSize + gap),
        backgroundColor: color,
        opacity: getSyncedLoaderDotOpacity(getSyncedLoaderStep(Date.now()), dotIndex),
      })),
    [color, dotSize, gap],
  );
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={frameStyle}
      aria-hidden="true"
    >
      <span className="relative" style={gridStyle}>
        {dotStyles.map((style, dotIndex) => (
          <span
            key={DOT_INDEXES[dotIndex]}
            ref={dotRefs[dotIndex]}
            className="absolute rounded-full"
            style={style}
          />
        ))}
      </span>
    </span>
  );
}
