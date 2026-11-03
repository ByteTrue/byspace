import { BYSPACE_LOGO_PATH, BYSPACE_LOGO_VIEWBOX } from "./byspace-logo-path";
import { useThemeObject } from "~/app/theme-object";

export { BYSPACE_LOGO_PATH, BYSPACE_LOGO_VIEWBOX };

interface BySpaceLogoProps {
  size?: number;
  color?: string;
}

export function BySpaceLogo({ size = 64, color }: BySpaceLogoProps) {
  const theme = useThemeObject();
  const fill = color ?? theme.colors.foreground;

  return (
    <svg width={size} height={size} viewBox={BYSPACE_LOGO_VIEWBOX} fill="none">
      <path d={BYSPACE_LOGO_PATH} fill={fill} />
    </svg>
  );
}
