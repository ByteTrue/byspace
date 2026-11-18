import { useMemo, type CSSProperties } from "react";

/** Renders raw SVG markup at the given size; `currentColor` inside it follows `color`. */
export function SvgXml({
  xml,
  width,
  height,
  color,
  style,
}: {
  xml: string | null;
  width?: number | string;
  height?: number | string;
  color?: string;
  style?: CSSProperties;
}) {
  const frameStyle = useMemo(
    () => ({ width, height, color, ...style }),
    [color, height, style, width],
  );
  // Markup comes from the provider catalog and daemon snapshots, the same trust as the Expo app.
  const markup = useMemo(() => ({ __html: xml ?? "" }), [xml]);
  if (!xml) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 [&>svg]:size-full"
      style={frameStyle}
      dangerouslySetInnerHTML={markup}
    />
  );
}
