// Override of packages/app/src/agent-stream/chat-outline/rail.web.tsx: one tick per prompt down the
// left edge of a wide conversation; hovering magnifies the ticks near the pointer and previews the
// prompt, pressing jumps to it. Hover lives on the rail and slots, never on the button inside, so
// magnifying a slot cannot move the box the pointer rests on (docs/hover.md).
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import { createChatOutlineHoverIntent } from "@/agent-stream/chat-outline/hover-intent";
import {
  promptTickMagnification,
  type ActivePromptSource,
  type ChatOutlinePrompt,
} from "@/agent-stream/chat-outline/model";
import { cn } from "cn";

const RAIL_WIDTH = 36;
const SLOT_HEIGHT = 8;
const MIN_PANEL_WIDTH = 918;
const RESTING_PILL_HEIGHT = 2;
const MAGNIFIED_PILL_HEIGHT = 4;
const RESTING_PILL_WIDTH = 10;
const ACTIVE_PILL_WIDTH = 18;
const MAGNIFIED_PILL_WIDTH = 26;
const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 48;
const PREVIEW_GAP = 4;
const RAIL_STYLE = { width: RAIL_WIDTH };
const SLOT_STYLE = { width: RAIL_WIDTH, flexBasis: SLOT_HEIGHT };
const PREVIEW_STYLE = {
  left: RAIL_WIDTH + PREVIEW_GAP,
  marginTop: -PREVIEW_HEIGHT / 2,
  width: PREVIEW_WIDTH,
  height: PREVIEW_HEIGHT,
};

function pillColorClass(hasAttention: boolean, isActive: boolean): string {
  if (hasAttention) return "bg-foreground";
  return isActive ? "bg-ring" : "bg-input";
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export interface ChatOutlineRailProps {
  prompts: ChatOutlinePrompt[];
  activePrompt: ActivePromptSource;
  onJumpToPrompt: (seq: number) => void;
}

export const ChatOutlineRail = memo(function ChatOutlineRail({
  prompts,
  activePrompt,
  onJumpToPrompt,
}: ChatOutlineRailProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const activeSeq = useSyncExternalStore(activePrompt.subscribe, activePrompt.getActiveSeq);
  const prefersReducedMotion = usePrefersReducedMotion();
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [isPanelNarrow, setIsPanelNarrow] = useState(true);
  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const update = () => setIsPanelNarrow(node.getBoundingClientRect().width < MIN_PANEL_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [prompts.length]);
  const hoverIntent = useMemo(
    () =>
      createChatOutlineHoverIntent({
        activate: setHoveredIndex,
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (timerId) => window.clearTimeout(timerId),
      }),
    [],
  );
  useEffect(() => () => hoverIntent.dispose(), [hoverIntent]);
  const handlePointerEnterRail = useCallback(
    (event: PointerEvent) => hoverIntent.enter({ x: event.clientX, y: event.clientY }),
    [hoverIntent],
  );
  const handlePointerMoveRail = useCallback(
    (event: PointerEvent) => hoverIntent.move({ x: event.clientX, y: event.clientY }),
    [hoverIntent],
  );
  const handlePointerLeaveRail = useCallback(() => hoverIntent.leave(), [hoverIntent]);
  const handleHoverTick = useCallback(
    (tickIndex: number) => hoverIntent.pointAt(tickIndex),
    [hoverIntent],
  );
  useEffect(() => {
    if (isPanelNarrow) hoverIntent.leave();
  }, [hoverIntent, isPanelNarrow]);
  const handleFocusChange = useCallback((index: number, focused: boolean) => {
    setFocusedIndex((current) => {
      if (focused) return index;
      return current === index ? null : current;
    });
  }, []);
  // The pointer owns the magnified band while it is on the rail; keyboard focus drives the same
  // band and preview once the pointer leaves.
  const attentionIndex = hoveredIndex ?? focusedIndex;
  if (prompts.length < 2) return null;
  return (
    <div ref={measureRef} className="pointer-events-none absolute inset-0">
      {isPanelNarrow ? null : (
        <div
          role="tablist"
          data-testid="chat-outline-rail"
          className="pointer-events-auto absolute top-[10%] bottom-[10%] left-2 z-[2] flex flex-col items-center justify-center"
          style={RAIL_STYLE}
          onPointerEnter={handlePointerEnterRail}
          onPointerMove={handlePointerMoveRail}
          onPointerLeave={handlePointerLeaveRail}
        >
          {prompts.map((prompt, index) => (
            <ChatOutlineTick
              key={prompt.seq}
              index={index}
              seq={prompt.seq}
              preview={prompt.preview}
              label={`${index + 1} of ${prompts.length}: ${prompt.preview}`}
              isActive={prompt.seq === activeSeq}
              hasAttention={index === attentionIndex}
              magnification={
                prefersReducedMotion || attentionIndex === null
                  ? 0
                  : promptTickMagnification(index - attentionIndex)
              }
              onHover={handleHoverTick}
              onFocusChange={handleFocusChange}
              onJumpToPrompt={onJumpToPrompt}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const ChatOutlineTick = memo(function ChatOutlineTick({
  index,
  seq,
  preview,
  label,
  isActive,
  hasAttention,
  magnification,
  onHover,
  onFocusChange,
  onJumpToPrompt,
}: {
  index: number;
  seq: number;
  preview: string;
  label: string;
  isActive: boolean;
  hasAttention: boolean;
  magnification: number;
  onHover: (index: number) => void;
  onFocusChange: (index: number, focused: boolean) => void;
  onJumpToPrompt: (seq: number) => void;
}) {
  const handleClick = useCallback(() => {
    onJumpToPrompt(seq);
    onFocusChange(index, false);
  }, [index, onFocusChange, onJumpToPrompt, seq]);
  const handlePointerEnter = useCallback(() => onHover(index), [index, onHover]);
  const handleFocus = useCallback(() => onFocusChange(index, true), [index, onFocusChange]);
  const handleBlur = useCallback(() => onFocusChange(index, false), [index, onFocusChange]);
  // The pill grows inside a slot that never moves, so magnification can never pull the hit
  // target out from under the pointer.
  const restingWidth = isActive ? ACTIVE_PILL_WIDTH : RESTING_PILL_WIDTH;
  const pillWidth = restingWidth + magnification * (MAGNIFIED_PILL_WIDTH - restingWidth);
  const pillHeight =
    RESTING_PILL_HEIGHT + magnification * (MAGNIFIED_PILL_HEIGHT - RESTING_PILL_HEIGHT);
  const pillStyle = useMemo(
    () => ({ width: pillWidth, height: pillHeight }),
    [pillHeight, pillWidth],
  );
  return (
    // Slots tile the rail with no gaps, so every pixel belongs to a prompt even when a long
    // conversation squeezes them below their resting height.
    <div
      className="relative flex shrink items-center justify-center"
      style={SLOT_STYLE}
      onPointerEnter={handlePointerEnter}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={label}
        data-testid={`chat-outline-tick-${seq}`}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="flex size-full items-center justify-start rounded-md pl-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            "rounded-full transition-[width,height,background-color] duration-[140ms] ease-out",
            pillColorClass(hasAttention, isActive),
          )}
          style={pillStyle}
        />
      </button>
      {hasAttention ? (
        <div
          aria-hidden="true"
          data-testid="chat-outline-preview"
          className="pointer-events-none absolute top-1/2 flex flex-col justify-center rounded-lg border bg-muted px-3 shadow-md"
          style={PREVIEW_STYLE}
        >
          <span className="line-clamp-2 text-xs text-foreground">{preview}</span>
        </div>
      ) : null}
    </div>
  );
});
