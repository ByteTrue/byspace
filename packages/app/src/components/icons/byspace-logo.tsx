import Svg, { Path } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";
import { BYSPACE_LOGO_PATH, BYSPACE_LOGO_VIEWBOX } from "./byspace-logo-path";

export { BYSPACE_LOGO_PATH, BYSPACE_LOGO_VIEWBOX };

interface BySpaceLogoProps {
  size?: number;
  color?: string;
}

export function BySpaceLogo({ size = 64, color }: BySpaceLogoProps) {
  const { theme } = useUnistyles();
  const fill = color ?? theme.colors.foreground;

  return (
    <Svg width={size} height={size} viewBox={BYSPACE_LOGO_VIEWBOX} fill="none">
      <Path d={BYSPACE_LOGO_PATH} fill={fill} />
    </Svg>
  );
}
