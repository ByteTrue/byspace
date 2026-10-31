// Stand-in for react-native-svg: its elements are the DOM's own SVG elements under other names,
// so shared icon modules render unchanged.
import { useMemo, type CSSProperties, type ReactNode, type SVGProps } from "react";

type Props<E extends SVGElement> = Omit<SVGProps<E>, "style"> & {
  style?: CSSProperties;
  testID?: string;
  children?: ReactNode;
};

// `color` is an SVG presentation attribute, so `currentColor` inside follows it.
function Svg({ testID, ...props }: Props<SVGSVGElement>) {
  return <svg data-testid={testID} {...props} />;
}
export default Svg;
export { Svg };
export const Path = (props: Props<SVGPathElement>) => <path {...props} />;
export const Circle = (props: Props<SVGCircleElement>) => <circle {...props} />;
export const Rect = (props: Props<SVGRectElement>) => <rect {...props} />;
export const Line = (props: Props<SVGLineElement>) => <line {...props} />;
export const G = (props: Props<SVGGElement>) => <g {...props} />;
export const Defs = (props: Props<SVGDefsElement>) => <defs {...props} />;
export const LinearGradient = (props: Props<SVGLinearGradientElement>) => (
  <linearGradient {...props} />
);
export const Stop = ({
  stopColor,
  stopOpacity,
  ...props
}: Props<SVGStopElement> & { stopColor?: string; stopOpacity?: number | string }) => (
  <stop stopColor={stopColor} stopOpacity={stopOpacity} {...props} />
);

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
