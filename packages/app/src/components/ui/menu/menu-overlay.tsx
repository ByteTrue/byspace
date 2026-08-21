import { useCallback, useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Dimensions, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Keyframe } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { FloatingScrollView, FloatingSurface } from "@/components/ui/floating";
import {
  getOverlayRoot,
  OverlayLayerProvider,
  useOverlayLayer,
  useWebOverlayRegistration,
} from "@/lib/overlay-root";
import {
  computePosition,
  getTransformOrigin,
  measureElement,
  type Alignment,
  type Placement,
  type Rect,
  type Size,
} from "./menu-anchor";

const SCROLL_CONTENT_STYLE = { flexGrow: 1 } as const;
const CONTENT_ENTERING_DURATION_MS = 150;

const contentEntering = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.97 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(CONTENT_ENTERING_DURATION_MS);

function releaseFixedMenuHeight(surfaceNativeID: string): void {
  if (typeof document === "undefined") return;
  document.getElementById(surfaceNativeID)?.style.removeProperty("height");
}

/**
 * Reanimated's web entering animation leaves an inline height snapshot on the measured surface.
 * Once the menu is open, height must return to content-sized so rows can grow in place — and so
 * a submenu page taller than the page it replaced is not clipped to the old height.
 *
 * `revision` is what makes that second case work: bump it whenever the rendered content changes
 * identity (a page push, for instance) and the snapshot is released again.
 */
function useReleaseFixedMenuHeight({
  contentSize,
  enabled,
  surfaceNativeID,
  revision,
}: {
  contentSize: Size | null;
  enabled: boolean;
  surfaceNativeID: string;
  revision?: string | number;
}): void {
  useEffect(() => {
    if (!enabled) return undefined;

    const release = () => {
      releaseFixedMenuHeight(surfaceNativeID);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => releaseFixedMenuHeight(surfaceNativeID));
      }
    };
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(release, CONTENT_ENTERING_DURATION_MS),
    ];

    if (contentSize) {
      timers.push(setTimeout(release, 0));
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [contentSize, enabled, surfaceNativeID, revision]);
}

/**
 * Resolves where an anchored surface sits: measures the anchor, measures the content, and runs
 * the two through `computePosition`. Returns nulls until both measurements have landed, which is
 * why the surface renders off-screen at -9999 rather than at 0,0 on its first frame.
 */
export function useAnchoredPosition({
  open,
  anchorRect,
  anchorRef,
  side,
  align,
  offset,
  scrollable,
  maxHeight,
}: {
  open: boolean;
  anchorRect: Rect | null;
  anchorRef: React.RefObject<View | null>;
  side: Placement;
  align: Alignment;
  offset: number;
  scrollable: boolean;
  maxHeight?: number;
}) {
  const [triggerRect, setTriggerRect] = useState<Rect | null>(null);
  const [contentSize, setContentSize] = useState<Size | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [actualPlacement, setActualPlacement] = useState<Placement>(side);

  const visibleContentSize = useMemo(() => {
    if (!contentSize) return null;
    if (!scrollable) return contentSize;

    const { height: screenHeight } = Dimensions.get("window");
    const viewportMaxHeight = Math.max(screenHeight - 16, 0);
    const resolvedMaxHeight =
      typeof maxHeight === "number" ? Math.min(maxHeight, viewportMaxHeight) : viewportMaxHeight;

    return {
      width: contentSize.width,
      height: Math.min(contentSize.height, resolvedMaxHeight),
    };
  }, [contentSize, scrollable, maxHeight]);

  useEffect(() => {
    if (!open) {
      setTriggerRect(null);
      setContentSize(null);
      setPosition(null);
      return undefined;
    }

    if (anchorRect) {
      setTriggerRect(anchorRect);
      return undefined;
    }

    if (!anchorRef.current) {
      setTriggerRect(null);
      return undefined;
    }
    let cancelled = false;
    void measureElement(anchorRef.current).then((rect) => {
      if (!cancelled) setTriggerRect(rect);
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [anchorRect, anchorRef, open]);

  useEffect(() => {
    if (!triggerRect || !visibleContentSize) return;

    const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
    const result = computePosition({
      triggerRect,
      contentSize: visibleContentSize,
      displayArea: { x: 0, y: 0, width: screenWidth, height: screenHeight },
      placement: side,
      alignment: align,
      offset,
    });

    setPosition({ x: result.x, y: result.y });
    setActualPlacement(result.actualPlacement);
  }, [triggerRect, visibleContentSize, side, align, offset]);

  const onContentLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = event.nativeEvent.layout;
      setContentSize((current) => {
        if (current && current.width === width && current.height === height) return current;
        return { width, height };
      });
    },
    [],
  );

  return { position, actualPlacement, contentSize, visibleContentSize, onContentLayout };
}

export interface AnchoredSurfaceProps {
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
  anchorRect: Rect | null;
  anchorRef: React.RefObject<View | null>;
  side?: Placement;
  align?: Alignment;
  offset?: number;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  fullWidth?: boolean;
  horizontalPadding?: number;
  scrollable?: boolean;
  /** Bump when the rendered content changes identity, so the height snapshot is released. */
  revision?: string | number;
  /** A submenu sits inside its parent's overlay and must not paint a second backdrop. */
  backdrop?: boolean;
  /**
   * Hover tracking for the surface box, per docs/hover.md: plain View, pointer events, never
   * a Pressable. Web-only by nature, which is all a flyout needs.
   */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  testID?: string;
  children: ReactElement;
}

/**
 * One floating menu surface, positioned against an anchor. The root menu renders one of these
 * against its trigger; every open submenu renders another against the row that opened it.
 */
export function AnchoredSurface({
  open,
  onClose,
  anchorRect,
  anchorRef,
  side = "bottom",
  align = "start",
  offset = 4,
  width,
  minWidth = 180,
  maxWidth,
  maxHeight,
  fullWidth = false,
  horizontalPadding = 16,
  scrollable = false,
  revision,
  backdrop = true,
  onPointerEnter,
  onPointerLeave,
  testID,
  children,
}: AnchoredSurfaceProps): ReactElement | null {
  const { t } = useTranslation();
  const surfaceNativeID = useId();
  const { position, actualPlacement, contentSize, visibleContentSize, onContentLayout } =
    useAnchoredPosition({
      open,
      anchorRect,
      anchorRef,
      side,
      align,
      offset,
      scrollable,
      maxHeight,
    });

  useReleaseFixedMenuHeight({
    contentSize,
    enabled: open,
    surfaceNativeID,
    revision,
  });

  const frameStyle = useMemo<StyleProp<ViewStyle>>(() => {
    const { width: screenWidth } = Dimensions.get("window");
    const resolvedWidthStyle: ViewStyle = fullWidth
      ? { width: screenWidth - horizontalPadding * 2 }
      : {
          ...(typeof width === "number" ? { width } : null),
          ...(typeof minWidth === "number" ? { minWidth } : null),
          ...(typeof maxWidth === "number" ? { maxWidth } : null),
        };
    return [
      resolvedWidthStyle,
      {
        position: "absolute" as const,
        top: position?.y ?? -9999,
        left: fullWidth ? horizontalPadding : (position?.x ?? -9999),
        transformOrigin: getTransformOrigin(actualPlacement, align),
        // Mount for measurement, but never expose the off-screen sentinel frame.
        opacity: position ? 1 : 0,
      },
    ];
  }, [fullWidth, horizontalPadding, position, width, minWidth, maxWidth, actualPlacement, align]);

  const scrollViewportStyle = useMemo(
    () => [visibleContentSize ? { height: visibleContentSize.height } : null],
    [visibleContentSize],
  );

  if (!open) return null;

  const measured = (
    <View
      collapsable={false}
      onLayout={onContentLayout}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </View>
  );

  return (
    <>
      {backdrop ? (
        <Pressable
          {...{ onContextMenu: onClose }}
          accessibilityRole="button"
          accessibilityLabel={t("menu.backdrop")}
          style={styles.backdrop}
          onPress={onClose}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
      ) : null}
      <FloatingSurface
        collapsable={false}
        tabIndex={-1}
        nativeID={surfaceNativeID}
        testID={testID}
        style={styles.content}
        frameStyle={frameStyle}
        entering={contentEntering}
      >
        {scrollable ? (
          <FloatingScrollView
            bounces={false}
            showsVerticalScrollIndicator
            style={scrollViewportStyle}
            contentContainerStyle={SCROLL_CONTENT_STYLE}
          >
            {measured}
          </FloatingScrollView>
        ) : (
          measured
        )}
      </FloatingSurface>
    </>
  );
}

/** The full-screen Web portal containing every surface in one menu. */
export function MenuOverlay({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactElement | null;
}): ReactElement | null {
  const floatingLayer = useOverlayLayer("floating");

  const handleWebOverlayKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return true;
    },
    [onClose],
  );
  const setWebOverlayScope = useWebOverlayRegistration({
    active: visible,
    layer: floatingLayer,
    onKeyDown: handleWebOverlayKeyDown,
  });

  if (!visible) return null;

  const overlay = (
    <OverlayLayerProvider layer={floatingLayer}>
      <View
        {...{
          onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
        }}
        ref={setWebOverlayScope}
        collapsable={false}
        style={[styles.overlay, styles.overlayWeb, { zIndex: floatingLayer }]}
      >
        {children}
      </View>
    </OverlayLayerProvider>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, getOverlayRoot());
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
  },
  overlayWeb: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: "auto" as const,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  content: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    ...theme.shadow.md,
  },
}));
