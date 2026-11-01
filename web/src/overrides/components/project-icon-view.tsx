// Override of packages/app/src/components/project-icon-view.tsx: a project's chosen image, or a
// rounded square in its identity colour carrying its initial. `textStyle` sizes the initial.
import { useMemo, type CSSProperties } from "react";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";

/** The generated icon's corner radius as a fraction of the box (see the Expo file). */
const RADIUS_RATIO = 0.25;

export function projectIconRadius(size: number): number {
  return Math.round(size * RADIUS_RATIO);
}

export function ProjectIconView({
  iconDataUri,
  initial,
  projectViewKey,
  size,
  textStyle,
}: {
  iconDataUri: string | null;
  initial: string;
  projectViewKey: string;
  size: number;
  textStyle?: CSSProperties;
}) {
  // A user-uploaded icon is sized but never clipped: it is someone's mark.
  const box = useMemo<CSSProperties>(() => ({ width: size, height: size }), [size]);
  const fallbackStyle = useMemo<CSSProperties>(
    () => ({
      ...box,
      borderRadius: projectIconRadius(size),
      backgroundColor: identityColor(deriveIdentityColorName(projectViewKey)),
      ...textStyle,
    }),
    [box, size, projectViewKey, textStyle],
  );
  if (iconDataUri) {
    return <img src={iconDataUri} alt="" className="shrink-0 object-contain" style={box} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center leading-none text-white"
      style={fallbackStyle}
    >
      {initial}
    </span>
  );
}
