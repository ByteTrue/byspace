// Override of packages/app/src/components/zoomable-viewport/image.tsx: an image in the zoomable
// viewport once its size is known; until then the image fills the box.
import { useEffect, useState, type CSSProperties } from "react";
import type { ViewportFitOptions, ViewportSize } from "@/components/zoomable-viewport/geometry";
import { ZoomableViewport, type ZoomableViewportAction } from "@/components/zoomable-viewport";
import { cn } from "cn";

export function ZoomableImage({
  uri,
  accessibilityLabel,
  actions,
  contentSize,
  fit,
  maxScale,
  minScale = 1,
  onError,
  onPressOutsideContent,
  className,
  style,
  testID = "zoomable-image",
  wheelActivation = "always",
}: {
  uri: string;
  accessibilityLabel?: string;
  actions?: ZoomableViewportAction[];
  contentSize?: ViewportSize;
  fit?: ViewportFitOptions;
  maxScale?: number;
  minScale?: number;
  onError?: () => void;
  onPressOutsideContent?: () => void;
  className?: string;
  style?: CSSProperties;
  testID?: string;
  wheelActivation?: "always" | "modifier";
}) {
  const [loadedSize, setLoadedSize] = useState<ViewportSize | null>(null);
  const resolvedSize = contentSize ?? loadedSize;
  useEffect(() => {
    if (contentSize) return;
    let active = true;
    setLoadedSize(null);
    const image = new Image();
    image.addEventListener("load", () => {
      if (active && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setLoadedSize({ width: image.naturalWidth, height: image.naturalHeight });
      }
    });
    image.addEventListener("error", () => {
      if (active) onError?.();
    });
    image.src = uri;
    return () => {
      active = false;
    };
  }, [contentSize, onError, uri]);
  if (!resolvedSize) {
    return (
      <div className={cn("min-h-0 flex-1", className)} style={style} data-testid={testID}>
        <img
          src={uri}
          alt={accessibilityLabel ?? ""}
          onError={onError}
          className="size-full object-contain"
          data-testid={`${testID}-image`}
        />
      </div>
    );
  }
  return (
    <ZoomableViewport
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      contentSize={resolvedSize}
      fit={fit}
      maxScale={maxScale}
      minScale={minScale}
      onPressOutsideContent={onPressOutsideContent}
      className={className}
      style={style}
      testID={testID}
      wheelActivation={wheelActivation}
    >
      <img
        src={uri}
        alt=""
        onError={onError}
        className="size-full object-contain"
        draggable={false}
        data-testid={`${testID}-image`}
      />
    </ZoomableViewport>
  );
}
