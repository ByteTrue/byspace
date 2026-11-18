// Port of archive/expo-app:packages/app/src/git/pull-request-panel/checks-ring.tsx: the same ring, drawn as DOM
// SVG and coloured by class instead of the Unistyles palette.
import type { CheckPresentation } from "@/git/check-presentation";
import type { ChecksSummary } from "@/git/pull-request-panel/checks-summary";

/**
 * Geometry in a 20-unit box scaled to the requested size, so the ring keeps its stroke
 * weight next to the header text at any size.
 */
const VIEW_BOX = 20;
const STROKE_WIDTH = 3;
const CENTER = VIEW_BOX / 2;
const RADIUS = (VIEW_BOX - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Blank arc between segments so two adjacent colours stay legible at 20px. */
const SEGMENT_GAP = 2;
/** Floor for a segment, so one failure among twenty checks is still a visible mark. */
const MIN_SEGMENT = 1.5;

const STROKE: Record<CheckPresentation, string> = {
  actionRequired: "stroke-status-warning",
  warning: "stroke-status-warning",
  failure: "stroke-status-danger",
  pending: "stroke-status-warning",
  manual: "stroke-muted-foreground",
  success: "stroke-status-success",
  ignored: "stroke-muted-foreground",
};

interface RingSegment {
  status: CheckPresentation;
  /** Painted arc length. */
  dash: number;
  /** Distance from twelve o'clock to where this segment starts. */
  offset: number;
}

/**
 * Each status gets a slice of the circle proportional to its share of the run, laid out
 * clockwise from twelve. Gaps come out of the painted arc rather than the layout, so the
 * slices still add up to the whole circle and the last one lands back at twelve.
 */
function buildSegments(summary: ChecksSummary): RingSegment[] {
  const segments: RingSegment[] = [];
  let offset = 0;
  for (const part of summary.parts) {
    const arc = (part.count / summary.total) * CIRCUMFERENCE;
    // A single status owns the whole circle, and a gap there would read as a stray notch.
    const dash =
      summary.parts.length === 1 ? CIRCUMFERENCE : Math.max(arc - SEGMENT_GAP, MIN_SEGMENT);
    segments.push({ status: part.status, dash, offset });
    offset += arc;
  }
  return segments;
}

/** A change request's CI as one glyph: the run's statuses in proportion, worst first. */
export function ChecksRing({ summary, size }: { summary: ChecksSummary; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`}
      aria-hidden
      // SVG strokes start at three o'clock; the ring reads clockwise from twelve.
      className="shrink-0 -rotate-90"
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        fill="none"
        strokeWidth={STROKE_WIDTH}
        className="stroke-border"
      />
      {buildSegments(summary).map((segment) => (
        <circle
          key={segment.status}
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={`${segment.dash} ${CIRCUMFERENCE - segment.dash}`}
          strokeDashoffset={-segment.offset}
          className={STROKE[segment.status]}
        />
      ))}
    </svg>
  );
}
