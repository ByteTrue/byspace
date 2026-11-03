// The diagram over the whole window: a full-screen shadcn Dialog; Escape or a click outside the
// diagram closes it.
import { useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  MermaidIframeRuntime,
  type MermaidRenderedMessage,
} from "@/components/markdown/fence/mermaid/iframe-runtime";
import type { DiagramColorScheme } from "@/components/markdown/fence/mermaid/render-model";
import { useMermaidRenderModel } from "@/components/markdown/fence/mermaid/use-render-model";
import { ZoomableViewport } from "@/components/zoomable-viewport";
import { SPACING } from "@/styles/theme";

// The diagram is already in the render cache, so the viewport knows its size before the
// fullscreen iframe has re-rendered it.
const FALLBACK_SIZE = { width: 240, height: 240 };
const VIEWER_FIT = { padding: SPACING[6] };

export function MermaidFullscreenViewer({
  source,
  colorScheme,
  onClose,
}: {
  source: string;
  colorScheme: DiagramColorScheme;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { state, request, rendered, renderFailed } = useMermaidRenderModel({
    source,
    phase: "complete",
    colorScheme,
  });
  const handleRendered = useCallback(
    (message: MermaidRenderedMessage) => {
      rendered({
        revision: message.revision,
        source: message.source,
        colorScheme: message.colorScheme,
        dimensions: { height: message.height, width: message.width },
      });
    },
    [rendered],
  );
  const visible = state.visible;
  const contentSize = useMemo(
    () => (visible ? { width: visible.width, height: visible.height } : FALLBACK_SIZE),
    [visible],
  );
  const actions = useMemo(
    () => [
      {
        icon: X,
        label: t("common.actions.close"),
        onPress: onClose,
        testID: "mermaid-fullscreen-close",
      },
    ],
    [onClose, t],
  );
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    // Focus stays in the dialog, not in the diagram iframe, so Escape keeps working.
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="fixed inset-0 top-0 left-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-none p-0 ring-0 sm:max-w-none pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
      >
        <DialogTitle className="sr-only">{t("message.diagram.diagram")}</DialogTitle>
        <ZoomableViewport
          accessibilityLabel={t("message.diagram.diagram")}
          actions={actions}
          contentSize={contentSize}
          fit={VIEWER_FIT}
          minScale={1}
          onPressOutsideContent={onClose}
          testID="mermaid-fullscreen-viewport"
          wheelActivation="always"
        >
          <MermaidIframeRuntime
            request={request}
            onRendered={handleRendered}
            onRenderFailed={renderFailed}
          />
        </ZoomableViewport>
      </DialogContent>
    </Dialog>
  );
}
