// Override of packages/app/src/components/markdown/fence/mermaid/host.web.tsx: a mermaid fence
// shows its source until the sandboxed runtime has drawn it, then the diagram in a zoomable box
// the size of the drawing, with "view source" and "fullscreen". Same model and runtime.
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { Code, Maximize2, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import type { MarkdownPhase } from "@/components/markdown/fence/types";
import { MermaidFullscreenViewer } from "@/components/markdown/fence/mermaid/fullscreen-viewer";
import {
  MermaidIframeRuntime,
  type MermaidRenderedMessage,
} from "@/components/markdown/fence/mermaid/iframe-runtime.web";
import { useMermaidRenderModel } from "@/components/markdown/fence/mermaid/use-render-model";
import { ZoomableViewport } from "@/components/zoomable-viewport";
import { cn } from "cn";
import { useThemeObject } from "~/app/theme-object";

const MEASURING_SIZE = { width: 240, height: 240 };
/**
 * The toolbar overlays the top of the box (8px offset + 32px compact buttons) and the box clips
 * with `overflow: hidden`, so a shorter box leaves the buttons half-clipped and unclickable.
 */
const MIN_DIAGRAM_BOX_HEIGHT = 56;

export function MermaidFenceHost({ code, phase }: { code: string; phase: MarkdownPhase }) {
  const { t } = useTranslation();
  const colorScheme = useThemeObject().colorScheme;
  const { state, request, rendered, renderFailed } = useMermaidRenderModel({
    source: code,
    phase,
    colorScheme,
  });
  const [hasRuntimeContent, setHasRuntimeContent] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const showSourcePress = useCallback(() => setShowSource(true), []);
  const showDiagramPress = useCallback(() => setShowSource(false), []);
  const openFullscreen = useCallback(() => setIsFullscreen(true), []);
  const closeFullscreen = useCallback(() => setIsFullscreen(false), []);
  const handleRendered = useCallback(
    (message: MermaidRenderedMessage) => {
      setHasRuntimeContent(true);
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
  const canShowDiagram = visible !== null && hasRuntimeContent;
  const diagramVisible = canShowDiagram && !showSource;
  const runtimeHeight = Math.max(visible?.height ?? 240, 1);
  const actions = useMemo(
    () => [
      { icon: Code, label: t("message.diagram.viewSource"), onPress: showSourcePress },
      {
        icon: Maximize2,
        label: t("message.diagram.fullscreen"),
        onPress: openFullscreen,
        testID: "mermaid-fullscreen",
      },
    ],
    [openFullscreen, showSourcePress, t],
  );
  const diagramSize = useMemo(
    () => (visible ? { width: visible.width, height: visible.height } : MEASURING_SIZE),
    [visible],
  );
  const diagramStyle = useMemo<CSSProperties>(
    () => ({ height: runtimeHeight, minHeight: MIN_DIAGRAM_BOX_HEIGHT }),
    [runtimeHeight],
  );

  return (
    <>
      {diagramVisible ? null : (
        <div className="relative">
          <HighlightedCodeBlock code={code} language="mermaid" />
          {showSource && canShowDiagram ? (
            <button
              type="button"
              aria-label={t("message.diagram.viewDiagram")}
              onClick={showDiagramPress}
              className="absolute top-5 right-2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
            >
              <Workflow size={14} />
            </button>
          ) : null}
        </div>
      )}
      <ZoomableViewport
        accessibilityLabel={t("message.diagram.diagram")}
        actions={actions}
        contentSize={diagramSize}
        className={cn(
          diagramVisible
            ? "my-3 flex-none rounded-lg border bg-muted/50"
            : "pointer-events-none absolute! inset-x-0 top-0 h-60! opacity-0",
        )}
        style={diagramVisible ? diagramStyle : undefined}
        testID="mermaid-viewport"
        wheelActivation="modifier"
      >
        <MermaidIframeRuntime
          request={request}
          onRendered={handleRendered}
          onRenderFailed={renderFailed}
        />
      </ZoomableViewport>
      {isFullscreen && visible ? (
        <MermaidFullscreenViewer
          source={visible.source}
          colorScheme={visible.colorScheme}
          onClose={closeFullscreen}
        />
      ) : null}
    </>
  );
}
