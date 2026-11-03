// Port of archive/expo-app:packages/app/src/components/zoomable-viewport/toolbar.tsx: zoom in, zoom out, reset
// and the caller's actions, top-right over the viewport, shown while it is hovered or focused.
import { memo } from "react";
import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { cn } from "cn";
import type { ZoomableViewportAction } from "@/components/zoomable-viewport";

interface ResolvedViewportAction extends ZoomableViewportAction {
  disabled: boolean;
}

export const ViewportToolbar = memo(function ViewportToolbar({
  actions,
  maxScale,
  minScale,
  onReset,
  onZoomIn,
  onZoomOut,
  scale,
  visible,
}: {
  actions: ZoomableViewportAction[];
  maxScale: number;
  minScale: number;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  scale: number;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const viewportActions: ResolvedViewportAction[] = [
    {
      icon: ZoomIn,
      label: t("message.diagram.zoomIn"),
      onPress: onZoomIn,
      disabled: scale >= maxScale,
    },
    {
      icon: ZoomOut,
      label: t("message.diagram.zoomOut"),
      onPress: onZoomOut,
      disabled: scale <= minScale,
    },
    { icon: Scan, label: t("message.diagram.resetZoom"), onPress: onReset, disabled: scale === 1 },
    ...actions.map((action) => ({ ...action, disabled: false })),
  ];
  return (
    <div
      className="pointer-events-none absolute top-2 right-2 z-[1] flex gap-1"
      data-testid="zoomable-viewport-toolbar"
    >
      {viewportActions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.label}
            variant="secondary"
            size="icon-xs"
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onPress}
            data-testid={action.testID}
            className={cn(!visible && "opacity-0", visible && "pointer-events-auto")}
          >
            <Icon />
          </Button>
        );
      })}
    </div>
  );
});
