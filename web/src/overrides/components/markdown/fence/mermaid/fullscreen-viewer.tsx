// Override of packages/app/src/components/markdown/fence/mermaid/fullscreen-viewer.web.tsx: the
// diagram over the whole window, Escape or a click outside it closes.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  MermaidIframeRuntime,
  type MermaidRenderedMessage,
} from "@/components/markdown/fence/mermaid/iframe-runtime.web";
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
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [onClose]);
  // Focus stays in this document, not in the diagram iframe, so Escape keeps working.
  const contentLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    contentLayerRef.current?.focus();
  }, []);
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
  return createPortal(
    // data-state marks it an open layer for the shortcut engine (lib/overlay-root.ts), so Escape
    // closes the viewer and does not also interrupt the agent behind it.
    <div
      className="fixed inset-0 z-50 bg-background"
      role="dialog"
      aria-modal="true"
      data-state="open"
    >
      <div
        ref={contentLayerRef}
        tabIndex={-1}
        className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] outline-none"
      >
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
      </div>
    </div>,
    document.body,
  );
}
