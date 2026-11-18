export interface SvgPathIconProps {
  size?: number;
  color?: string;
  className?: string;
}

interface SvgPathIconInput extends SvgPathIconProps {
  path: string;
  viewBox: string;
}

export function SvgPathIcon({
  size = 16,
  color = "currentColor",
  className,
  path,
  viewBox,
}: SvgPathIconInput) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill={color} className={className}>
      <path d={path} />
    </svg>
  );
}
