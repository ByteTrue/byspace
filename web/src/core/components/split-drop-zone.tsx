// Port of packages/app/src/components/split-drop-zone.tsx: the drop target over a pane while a
// tab is dragged, with the half (or centre) it would land in shaded.
import { useDroppable } from "@dnd-kit/core";
import { cn } from "cn";

export type SplitDropZonePosition = "center" | "left" | "right" | "top" | "bottom";

export interface SplitDropZoneHover {
  paneId: string;
  position: SplitDropZonePosition;
}

export interface SplitDropZoneProps {
  paneId: string;
  active: boolean;
  preview: SplitDropZoneHover | null;
}

const EDGE_RATIO = 0.15;
const CENTER_RATIO = 0.4;

export function buildSplitDropZoneId(paneId: string): string {
  return `split-pane-drop:${paneId}`;
}

const PREVIEW_AREA: Record<SplitDropZonePosition, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
  center: "inset-2",
};

export function SplitDropZone({ paneId, active, preview }: SplitDropZoneProps) {
  const { setNodeRef } = useDroppable({
    id: buildSplitDropZoneId(paneId),
    disabled: !active,
    data: { kind: "split-pane-drop", paneId },
  });
  if (!active) return null;
  const position = preview?.paneId === paneId ? preview.position : null;
  return (
    <div ref={setNodeRef} className="pointer-events-none absolute inset-0 z-40">
      {position ? (
        <>
          <div className={cn("absolute rounded-md bg-primary/10", PREVIEW_AREA[position])} />
          <div
            className={cn("absolute rounded-md border-2 border-primary/60", PREVIEW_AREA[position])}
          />
        </>
      ) : null}
    </div>
  );
}

export function resolveSplitDropPosition(input: {
  width: number;
  height: number;
  x: number;
  y: number;
}): SplitDropZonePosition {
  const centerInsetX = input.width * ((1 - CENTER_RATIO) / 2);
  const centerInsetY = input.height * ((1 - CENTER_RATIO) / 2);
  const insideCenterX = input.x >= centerInsetX && input.x <= input.width - centerInsetX;
  const insideCenterY = input.y >= centerInsetY && input.y <= input.height - centerInsetY;
  if (insideCenterX && insideCenterY) return "center";
  const edgeThresholdX = input.width * EDGE_RATIO;
  const edgeThresholdY = input.height * EDGE_RATIO;
  if (input.x <= edgeThresholdX) return "left";
  if (input.x >= input.width - edgeThresholdX) return "right";
  if (input.y <= edgeThresholdY) return "top";
  if (input.y >= input.height - edgeThresholdY) return "bottom";
  const distances = [
    { position: "left", distance: input.x },
    { position: "right", distance: input.width - input.x },
    { position: "top", distance: input.y },
    { position: "bottom", distance: input.height - input.y },
  ] satisfies Array<{ position: Exclude<SplitDropZonePosition, "center">; distance: number }>;
  distances.sort((left, right) => left.distance - right.distance);
  return distances[0]?.position ?? "center";
}
