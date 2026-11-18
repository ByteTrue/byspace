// Port of archive/expo-app:packages/app/src/components/project-icon-view.tsx: a project's chosen image, or a
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
    }),
    [box, size, projectViewKey],
  );
  if (iconDataUri) {
    return <img src={iconDataUri} alt="" className="shrink-0 object-contain" style={box} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center" style={fallbackStyle}>
      {/* Its own line box, centred, as the Expo app's Text in the square: the initial sits
          where it does there (a box-height line put it half a pixel higher). */}
      <span className="leading-[normal] text-white" style={textStyle}>
        {initial}
      </span>
    </span>
  );
}
