// Port of packages/app/src/components/status-ring: the running ring, cut out of whatever it
// sits on so it reads over an icon.
import { memo } from "react";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { cn } from "cn";
import { StatusRing as RingGlyph } from "~/sidebar/status-visuals";

const BACKDROP_CLASS: Record<string, string> = {
  surface0: "bg-background",
  surface1: "bg-card",
  surfaceSidebar: "bg-sidebar",
};

export interface StatusRingProps {
  backdrop?: SurfaceBackdrop;
}

export const StatusRing = memo(function StatusRing({ backdrop = "surface0" }: StatusRingProps) {
  return (
    <span className={cn("inline-flex rounded-full", BACKDROP_CLASS[backdrop] ?? "bg-background")}>
      <RingGlyph />
    </span>
  );
});
