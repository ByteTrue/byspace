export interface SvgPathIconProps {
  size?: number;
  color?: string;
}

interface SvgPathIconInput extends SvgPathIconProps {
  path: string;
  viewBox: string;
}

export function SvgPathIcon({
  size = 16,
  color = "currentColor",
  path,
  viewBox,
}: SvgPathIconInput) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill={color}>
      <path d={path} />
    </svg>
  );
}
