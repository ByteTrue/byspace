// Port of archive/expo-app:packages/app/src/mobile-panels/provider.tsx and gestures.ts. The same transition model
// and gesture rules (mobile-panels/model.ts, gesture-intent.ts), run on the DOM instead of Reanimated
// worklets: one normalized position (-1 sidebar, 0 page, 1 explorer) drives both panels and both
// backdrops, written straight to their styles, so a drag never re-renders React. A panel counts as
// active once the position settles on its anchor, as in the Expo app. See docs/mobile-panels.md.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { resolveMobilePanelGestureIntent } from "@/mobile-panels/gesture-intent";
import {
  canBeginMobilePanelGesture,
  createMobilePanelMotionState,
  getMobilePanelAnchor,
  getMobilePanelFrame,
  isMobilePanelGestureCurrent,
  transitionMobilePanel,
  type MobilePanelCommit,
  type MobilePanelMotionState,
  type MobilePanelTransition,
} from "@/mobile-panels/model";
import {
  usePanelStore,
  type MobilePanelSelection,
  type MobilePanelView,
} from "@/stores/panel-store";
import {
  cubicBezier,
  mobilePanelGestureEndTarget,
  mobilePanelGesturePosition,
  type MobilePanelGestureKind,
} from "~/mobile-panels/gesture";

const ANIMATION_DURATION = 220;
// The Expo app's Easing.bezier(0.25, 0.1, 0.25, 1).
const ANIMATION_EASING = cubicBezier(0.25, 0.1, 0.25, 1);
// The Expo app's MOBILE_WEB_EDGE_SWIPE_WIDTH: on the web the open gestures start at the edges only.
const EDGE_SWIPE_WIDTH = 32;
const VELOCITY_WINDOW_MS = 100;

export type MobileOverlayPanel = Exclude<MobilePanelView, "agent">;
export type MobileOverlayPart = "root" | "backdrop" | "panel";

const GESTURES: Record<
  MobilePanelGestureKind,
  { origin: MobilePanelView; direction: 1 | -1; opens: boolean }
> = {
  "open-left": { origin: "agent", direction: 1, opens: true },
  "close-left": { origin: "agent-list", direction: -1, opens: false },
  "open-right": { origin: "agent", direction: -1, opens: true },
  "close-right": { origin: "file-explorer", direction: 1, opens: false },
};

interface OpenGesture {
  enabled: boolean;
  onOpen: () => void;
}

interface Tracking {
  kind: MobilePanelGestureKind;
  startX: number;
  startY: number;
  lastX: number;
  startedRevision: number;
  samples: Array<{ time: number; x: number }>;
}

/** Whether the touch began on something scrolled horizontally, which a right swipe scrolls back. */
function startsOnScrolledContent(target: EventTarget | null): boolean {
  for (let element = target instanceof Element ? target : null; element; ) {
    if (element.scrollLeft > 0 && element.scrollWidth > element.clientWidth) return true;
    element = element.parentElement;
  }
  return false;
}

class MobilePanelsRuntime {
  position: number;
  motion: MobilePanelMotionState;
  width = typeof window === "undefined" ? 0 : window.innerWidth;
  enabled = false;
  readonly openGestures: Record<MobileOverlayPanel, OpenGesture | null> = {
    "agent-list": null,
    "file-explorer": null,
  };
  readonly openBlockers = new Set<symbol>();
  private readonly overlays: Record<
    MobileOverlayPanel,
    Record<MobileOverlayPart, HTMLElement | null>
  > = {
    "agent-list": { root: null, backdrop: null, panel: null },
    "file-explorer": { root: null, backdrop: null, panel: null },
  };
  private frame: number | null = null;
  private tracking: Tracking | null = null;
  private suppressClick = false;

  constructor(
    selection: MobilePanelSelection,
    private readonly onSettled: (panel: MobilePanelView, revision: number) => void,
  ) {
    this.position = getMobilePanelAnchor(selection.target);
    this.motion = createMobilePanelMotionState(selection);
  }

  registerOverlay(panel: MobileOverlayPanel, part: MobileOverlayPart, element: HTMLElement | null) {
    this.overlays[panel][part] = element;
    this.applyFrame();
  }

  resize(width: number) {
    this.width = width;
    this.applyFrame();
  }

  private applyFrame() {
    const frame = getMobilePanelFrame(this.position, this.width);
    const left = this.overlays["agent-list"];
    const right = this.overlays["file-explorer"];
    if (left.root) left.root.style.display = this.position < 0 ? "block" : "none";
    if (left.panel) left.panel.style.transform = `translateX(${frame.leftTranslateX}px)`;
    if (left.backdrop) left.backdrop.style.opacity = String(frame.leftBackdropOpacity);
    if (right.root) right.root.style.display = this.position > 0 ? "block" : "none";
    if (right.panel) right.panel.style.transform = `translateX(${frame.rightTranslateX}px)`;
    if (right.backdrop) right.backdrop.style.opacity = String(frame.rightBackdropOpacity);
  }

  private setPosition(next: number) {
    this.position = Math.max(-1, Math.min(1, next));
    this.applyFrame();
    const settled = transitionMobilePanel(this.motion, {
      type: "position.changed",
      position: this.position,
    });
    if (settled.state === this.motion) return;
    this.motion = settled.state;
    this.onSettled(settled.state.settledTarget, settled.state.revision);
  }

  private cancelAnimation() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private animate(transition: MobilePanelTransition) {
    if (!transition.animationTarget) return;
    this.cancelAnimation();
    const from = this.position;
    const to = getMobilePanelAnchor(transition.animationTarget);
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / ANIMATION_DURATION);
      this.frame = progress < 1 ? requestAnimationFrame(step) : null;
      this.setPosition(from + (to - from) * ANIMATION_EASING(progress));
    };
    this.frame = requestAnimationFrame(step);
  }

  applySelection(selection: MobilePanelSelection) {
    const transition = transitionMobilePanel(this.motion, { type: "command", selection });
    if (transition.state === this.motion) return;
    this.motion = transition.state;
    this.animate(transition);
  }

  private beginGesture(origin: MobilePanelView): number {
    if (!canBeginMobilePanelGesture(this.motion, origin, this.position)) return -1;
    const transition = transitionMobilePanel(this.motion, { type: "gesture.begin", origin });
    this.motion = transition.state;
    this.cancelAnimation();
    return transition.state.gesture?.startedRevision ?? -1;
  }

  private finishGesture(input: {
    startedRevision: number;
    success: boolean;
    target: MobilePanelView;
  }): MobilePanelCommit | null {
    const transition = transitionMobilePanel(this.motion, { type: "gesture.finish", ...input });
    if (transition.state === this.motion) return null;
    this.motion = transition.state;
    this.animate(transition);
    return transition.commit ?? null;
  }

  /** The gesture a touch at this point may start, if any (the Expo app's four begin gates). */
  private pickGesture(x: number, target: EventTarget | null): MobilePanelGestureKind | null {
    const node = target instanceof Node ? target : null;
    if (canBeginMobilePanelGesture(this.motion, "agent", this.position)) {
      if (
        x <= EDGE_SWIPE_WIDTH &&
        this.openGestures["agent-list"]?.enabled &&
        !startsOnScrolledContent(target)
      ) {
        return "open-left";
      }
      if (x >= this.width - EDGE_SWIPE_WIDTH && this.openGestures["file-explorer"]?.enabled) {
        return "open-right";
      }
      return null;
    }
    if (canBeginMobilePanelGesture(this.motion, "agent-list", this.position)) {
      return this.overlays["agent-list"].root?.contains(node) ? "close-left" : null;
    }
    if (canBeginMobilePanelGesture(this.motion, "file-explorer", this.position)) {
      return this.overlays["file-explorer"].root?.contains(node) && !startsOnScrolledContent(target)
        ? "close-right"
        : null;
    }
    return null;
  }

  start(x: number, y: number, target: EventTarget | null) {
    this.tracking = null;
    // A touch swipe ends without a click, so a swallow still pending belongs to no click of this
    // press; left set, it would eat the next tap.
    this.suppressClick = false;
    if (!this.enabled) return;
    const kind = this.pickGesture(x, target);
    if (!kind) return;
    this.tracking = {
      kind,
      startX: x,
      startY: y,
      lastX: x,
      startedRevision: -1,
      samples: [{ time: performance.now(), x }],
    };
  }

  /** Follows the pointer; true once the gesture owns it (the caller then stops the page scroll). */
  move(x: number, y: number): boolean {
    const tracking = this.tracking;
    if (!tracking) return false;
    tracking.lastX = x;
    const deltaX = x - tracking.startX;
    if (tracking.startedRevision < 0) {
      const gesture = GESTURES[tracking.kind];
      const intent = resolveMobilePanelGestureIntent({
        deltaX,
        deltaY: y - tracking.startY,
        direction: gesture.direction,
        openGesturesBlocked: gesture.opens && this.openBlockers.size > 0,
      });
      if (intent === "fail") {
        this.tracking = null;
        return false;
      }
      if (intent === "wait") return false;
      tracking.startedRevision = this.beginGesture(gesture.origin);
      if (tracking.startedRevision < 0) {
        this.tracking = null;
        return false;
      }
    }
    const now = performance.now();
    tracking.samples.push({ time: now, x });
    while (tracking.samples.length > 2 && now - tracking.samples[0].time > VELOCITY_WINDOW_MS) {
      tracking.samples.shift();
    }
    if (!isMobilePanelGestureCurrent(this.motion, tracking.startedRevision)) return true;
    this.setPosition(mobilePanelGesturePosition(tracking.kind, deltaX, this.width));
    return true;
  }

  end(success: boolean) {
    const tracking = this.tracking;
    this.tracking = null;
    if (!tracking || tracking.startedRevision < 0) return;
    this.suppressClick = true;
    const first = tracking.samples[0];
    const last = tracking.samples[tracking.samples.length - 1];
    const elapsed = last.time - first.time;
    const velocityX = elapsed > 0 ? ((last.x - first.x) / elapsed) * 1000 : 0;
    const target = mobilePanelGestureEndTarget(
      tracking.kind,
      tracking.lastX - tracking.startX,
      velocityX,
      this.width,
    );
    const commit = this.finishGesture({
      startedRevision: tracking.startedRevision,
      success,
      target,
    });
    if (!commit) return;
    // As the Expo app's scheduleOnRN(commit): a newer command since the gesture began wins.
    const store = usePanelStore.getState();
    if (store.mobilePanel.revision !== commit.startedRevision) return;
    if (tracking.kind === "open-left") store.showMobileAgentList();
    else if (tracking.kind === "open-right") this.openGestures["file-explorer"]?.onOpen();
    else store.showMobileAgent();
  }

  /** A pointer gesture ends in a click on whatever it was released over; that click is not one. */
  takeSuppressedClick(): boolean {
    const suppress = this.suppressClick;
    this.suppressClick = false;
    return suppress;
  }

  dispose() {
    this.cancelAnimation();
    this.tracking = null;
  }
}

const MobilePanelsContext = createContext<MobilePanelsRuntime | null>(null);
const MobilePanelActiveContext = createContext<MobilePanelView>("agent");

function useGestureListeners(runtime: MobilePanelsRuntime, enabled: boolean) {
  useEffect(() => {
    runtime.enabled = enabled;
    if (!enabled) return;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) {
        runtime.end(false);
        return;
      }
      runtime.start(touch.clientX, touch.clientY, event.target);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) {
        runtime.end(false);
        return;
      }
      if (runtime.move(touch.clientX, touch.clientY) && event.cancelable) event.preventDefault();
    };
    const onTouchEnd = (event: TouchEvent) => runtime.end(event.type === "touchend");
    // gesture-handler took mouse pointers too on the web; touches arrive above as touch events.
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button === 0) {
        runtime.start(event.clientX, event.clientY, event.target);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") runtime.move(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "mouse") runtime.end(event.type === "pointerup");
    };
    const onClick = (event: MouseEvent) => {
      if (!runtime.takeSuppressedClick()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const resize = () => runtime.resize(window.innerWidth);
    const capture = { capture: true };
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    document.addEventListener("touchend", onTouchEnd, capture);
    document.addEventListener("touchcancel", onTouchEnd, capture);
    document.addEventListener("pointerdown", onPointerDown, capture);
    document.addEventListener("pointermove", onPointerMove, capture);
    document.addEventListener("pointerup", onPointerUp, capture);
    document.addEventListener("pointercancel", onPointerUp, capture);
    document.addEventListener("click", onClick, capture);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      runtime.end(false);
      document.removeEventListener("touchstart", onTouchStart, capture);
      document.removeEventListener("touchmove", onTouchMove, capture);
      document.removeEventListener("touchend", onTouchEnd, capture);
      document.removeEventListener("touchcancel", onTouchEnd, capture);
      document.removeEventListener("pointerdown", onPointerDown, capture);
      document.removeEventListener("pointermove", onPointerMove, capture);
      document.removeEventListener("pointerup", onPointerUp, capture);
      document.removeEventListener("pointercancel", onPointerUp, capture);
      document.removeEventListener("click", onClick, capture);
      window.removeEventListener("resize", resize);
    };
  }, [enabled, runtime]);
}

/** Owns the phone panels: their motion, gestures and the settled panel. Gestures run when enabled. */
export function MobilePanelsProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [activePanel, setActivePanel] = useState(() => usePanelStore.getState().mobilePanel.target);
  const [runtime] = useState(
    () =>
      new MobilePanelsRuntime(usePanelStore.getState().mobilePanel, (panel, revision) => {
        const selection = usePanelStore.getState().mobilePanel;
        if (selection.revision === revision && selection.target === panel) setActivePanel(panel);
      }),
  );

  useEffect(() => {
    const unsubscribe = usePanelStore.subscribe((state, previousState) => {
      if (state.mobilePanel !== previousState.mobilePanel)
        runtime.applySelection(state.mobilePanel);
    });
    return () => {
      unsubscribe();
      runtime.dispose();
    };
  }, [runtime]);

  useGestureListeners(runtime, enabled);

  return (
    <MobilePanelsContext.Provider value={runtime}>
      <MobilePanelActiveContext.Provider value={activePanel}>
        {children}
      </MobilePanelActiveContext.Provider>
    </MobilePanelsContext.Provider>
  );
}

/** Internal to the mobile-panels module. */
export function useMobilePanelsRuntime(): MobilePanelsRuntime {
  const context = useContext(MobilePanelsContext);
  if (!context) {
    throw new Error("useMobilePanelsRuntime must be used within MobilePanelsProvider");
  }
  return context;
}

export function useIsMobilePanelActive(panel: MobilePanelView): boolean {
  return useContext(MobilePanelActiveContext) === panel;
}

/** The Expo app's useOpenAgentListGesture / useOpenFileExplorerGesture, as an edge swipe. */
export function useMobilePanelOpenGesture(
  panel: MobileOverlayPanel,
  { enabled, onOpen }: { enabled: boolean; onOpen?: () => void },
): void {
  const runtime = useContext(MobilePanelsContext);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useLayoutEffect(() => {
    if (!runtime) return;
    runtime.openGestures[panel] = { enabled, onOpen: () => onOpenRef.current?.() };
    return () => {
      runtime.openGestures[panel] = null;
    };
  }, [enabled, panel, runtime]);
}

export function useBlockMobilePanelOpenGestures(blocked: boolean): void {
  const runtime = useContext(MobilePanelsContext);
  const owner = useRef(Symbol("mobile-panel-open-gesture-blocker")).current;
  useLayoutEffect(() => {
    if (!runtime || !blocked) return;
    runtime.openBlockers.add(owner);
    return () => {
      runtime.openBlockers.delete(owner);
    };
  }, [blocked, owner, runtime]);
}

/** A ref callback that hands one part of an overlay to the runtime, which moves it. */
export function useMobileOverlayPart(panel: MobileOverlayPanel, part: MobileOverlayPart) {
  const runtime = useMobilePanelsRuntime();
  return useCallback(
    (element: HTMLElement | null) => runtime.registerOverlay(panel, part, element),
    [panel, part, runtime],
  );
}
