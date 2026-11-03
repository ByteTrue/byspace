// Port of archive/expo-app:packages/app/src/components/ui/loading-spinner.tsx on shadcn's Spinner. React
// Native's "small" is 20px and "large" 36px; a number is a size in px.
import { useMemo, type CSSProperties } from "react";
import { Spinner } from "~/components/ui/spinner";

export function LoadingSpinner({
  color,
  size = "small",
  style,
  className,
}: {
  color?: string;
  size?: "small" | "large" | number;
  style?: CSSProperties | unknown;
  className?: string;
}) {
  let px = 16;
  if (size === "large") px = 32;
  else if (typeof size === "number") px = size;
  const spinnerStyle = useMemo(
    () => ({
      width: px,
      height: px,
      color,
      ...(style && typeof style === "object" && !Array.isArray(style)
        ? (style as CSSProperties)
        : {}),
    }),
    [color, px, style],
  );
  return <Spinner className={className} style={spinnerStyle} />;
}
