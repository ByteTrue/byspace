// Port of archive/expo-app:packages/app/src/composer/tracks.tsx: the strip of pills above the composer
// (subagents, tasks, diff stat, stream controls) and the panel each tracker opens. The bar floats
// over the transcript with no background; its host gives the scroll a small bottom inset only
// while the bar exists.
import {
  useCallback,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  MenuRoot,
  MenuSeparator,
  MenuSurface,
  MenuTrigger,
  useMenuContext,
} from "@/components/ui/menu";
import { StatusRing } from "@/components/status-ring";
import { composerPillClassName, composerPillLabelClassName } from "@/composer/pill-styles";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { cn } from "cn";

export function ComposerTrackBar({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center px-4 pb-2 md:pb-2.5"
      data-testid="composer-track-bar"
    >
      <div className="flex w-full max-w-[820px] items-center gap-1">{children}</div>
    </div>
  );
}

export interface ComposerTrackPillSegment {
  /** Leading mark — a dot, or the running ring. `null` draws the text on its own. */
  bucket: SidebarStateBucket | null;
  /** Short enough to stay on one line alongside its siblings: "1 failed", "2/7 tasks", "3". */
  text: string;
}

export interface ComposerTrackPillProps {
  /** The whole pill, left to right, at most one segment per state. */
  segments: readonly ComposerTrackPillSegment[];
  /** Sheet header on compact. Popovers never show one. */
  panelTitle: string;
  testID: string;
  /** Spell out anything the segments abbreviate — a bare count reads as nothing out loud. */
  accessibilityLabel?: string;
  children: ReactNode;
}

// The panel, not the pill: rows carry real content, and the surface still shrinks to it.
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 620;
const PANEL_MAX_HEIGHT = 440;
// Wider than a dropdown's gap: the panel is parked over the composer, not hanging off a control.
const PANEL_OFFSET = 12;

export function ComposerTrackPill({
  segments,
  panelTitle,
  testID,
  accessibilityLabel,
  children,
}: ComposerTrackPillProps): ReactElement {
  return (
    <MenuRoot>
      <ComposerTrackPillTrigger
        segments={segments}
        testID={testID}
        accessibilityLabel={accessibilityLabel ?? segments.map((segment) => segment.text).join(" ")}
      />
      <MenuSurface
        side="top"
        align="start"
        offset={PANEL_OFFSET}
        sheetTitle={panelTitle}
        minWidth={PANEL_MIN_WIDTH}
        maxWidth={PANEL_MAX_WIDTH}
        maxHeight={PANEL_MAX_HEIGHT}
        scrollable
        testID={`${testID}-panel`}
        className="overflow-y-auto"
      >
        {children}
      </MenuSurface>
    </MenuRoot>
  );
}

function ComposerTrackPillTrigger({
  segments,
  testID,
  accessibilityLabel,
}: {
  segments: readonly ComposerTrackPillSegment[];
  testID: string;
  accessibilityLabel: string;
}): ReactElement {
  const { open } = useMenuContext("ComposerTrackPill");
  return (
    <MenuTrigger
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      className={composerPillClassName(open, "pointer-events-auto min-w-0 shrink hover:bg-muted")}
    >
      {/* Segments sit twice as far apart as a mark from its own text, so a count reads as
          belonging to the mark on its left. */}
      <span className="flex min-w-0 shrink items-center gap-4">
        {segments.map((segment, index) => (
          <span
            key={segment.bucket ?? "plain"}
            className="flex min-w-0 shrink items-center gap-2"
            data-testid={`${testID}-segment-${index}`}
          >
            <ComposerTrackMark bucket={segment.bucket} />
            <span className={composerPillLabelClassName(open)}>{segment.text}</span>
          </span>
        ))}
      </span>
    </MenuTrigger>
  );
}

/**
 * Actions for the whole panel (bulk archive). They sit above the rows: reaching one means
 * travelling past every row it affects, and it cannot sit under a thumb aiming for a row.
 */
export function ComposerTrackActions({
  children,
  divided = true,
}: {
  children: ReactNode;
  /** False when the list below is empty — a divider with nothing under it separates nothing. */
  divided?: boolean;
}): ReactElement {
  return (
    <>
      {children}
      {divided ? <MenuSeparator /> : null}
    </>
  );
}

export interface ComposerTrackRowProps {
  /** A function child receives the row's own hover/press state, for hover-revealed actions. */
  children: ReactNode | ((state: { active: boolean }) => ReactNode);
  /** Rows that open something are pressable and fill on press or hover. A read-only row is not. */
  onPress?: () => void;
  /** Dismiss the panel when this row is chosen (a row that navigates away is done with it). */
  closeOnSelect?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

const ROW = "mx-1 flex min-h-8 items-center gap-2 rounded-md px-2 py-1";

/**
 * One line in a track panel, the same rail for every tracker. Rows carry action buttons, so the
 * row is a focusable div rather than a button (buttons cannot nest); the actions stop their
 * clicks from reaching it.
 */
export function ComposerTrackRow({
  children,
  onPress,
  closeOnSelect = true,
  disabled = false,
  accessibilityLabel,
  testID,
}: ComposerTrackRowProps): ReactElement {
  const { selectItem } = useMenuContext("ComposerTrackRow");
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const handleSelect = useCallback(() => {
    if (!disabled) selectItem(onPress, closeOnSelect);
  }, [closeOnSelect, disabled, onPress, selectItem]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " "))
        return;
      event.preventDefault();
      handleSelect();
    },
    [handleSelect],
  );
  const content = (active: boolean) =>
    typeof children === "function" ? children({ active }) : children;
  if (!onPress) {
    return (
      <div aria-label={accessibilityLabel} className={ROW}>
        {content(false)}
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={accessibilityLabel}
      data-testid={testID}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className={cn(ROW, "cursor-pointer", hovered && "bg-muted")}
    >
      {content(hovered)}
    </div>
  );
}

const DOT_CLASS: Record<Exclude<SidebarStateBucket, "running">, string> = {
  needs_input: "bg-status-dot-warning",
  failed: "bg-status-dot-danger",
  attention: "bg-status-dot-success",
  done: "bg-border",
};

/** A segment's state mark: the running ring, or the dot it grows from, each sized to its glyph. */
function ComposerTrackMark({ bucket }: { bucket: SidebarStateBucket | null }): ReactElement | null {
  if (!bucket) return null;
  if (bucket === "running") {
    return (
      <span className="-m-px flex">
        <StatusRing />
      </span>
    );
  }
  return <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[bucket])} />;
}
