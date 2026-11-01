// Override of packages/app/src/components/ui/toolbar-label-trigger.tsx: the small label buttons in a
// pane toolbar (branch, diff mode, pull request). The Expo file returns React Native styles; here
// the frame and label are class names. The label is muted until the button is hovered, pressed or
// its menu is open (Radix's data-state).
import {
  forwardRef,
  useCallback,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

export interface ToolbarLabelTriggerState {
  pressed?: boolean;
  hovered?: boolean;
  open?: boolean;
}

export function isToolbarLabelTriggerHighlighted(state: ToolbarLabelTriggerState): boolean {
  return Boolean(state.hovered) || Boolean(state.pressed) || Boolean(state.open);
}

/** Shared spacing for interactive triggers and visually aligned passive context. */
export const TOOLBAR_LABEL_TRIGGER_FRAME =
  "flex min-w-0 shrink items-center gap-1.5 rounded-md p-1";

/** The frame of a label button: highlighted on hover, press, and while its menu is open. */
export const TOOLBAR_LABEL_TRIGGER_CLASS = cn(
  TOOLBAR_LABEL_TRIGGER_FRAME,
  "group/toolbar-label hover:bg-interaction-highlight active:bg-interaction-highlight data-[state=open]:bg-interaction-highlight",
);

/** The label inside TOOLBAR_LABEL_TRIGGER_CLASS: muted until the button is highlighted. */
export const TOOLBAR_LABEL_TRIGGER_TEXT =
  "min-w-0 shrink truncate text-xs text-muted-foreground group-hover/toolbar-label:text-foreground group-active/toolbar-label:text-foreground group-data-[state=open]/toolbar-label:text-foreground";

/** Fixed geometry for glyphs beside labels. Text yields space; icons never do. */
export function ToolbarLabelTriggerIcon({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center justify-center">{children}</span>;
}

interface ToolbarLabelSelectTriggerProps extends Omit<ComponentProps<"button">, "children"> {
  label: string;
  open?: boolean;
  leadingIcon?: ReactNode;
  testID?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: string;
}

/** The shared current/base branch geometry. Disabled keeps the frame but has no interaction. */
export const ToolbarLabelSelectTrigger = forwardRef<
  HTMLButtonElement,
  ToolbarLabelSelectTriggerProps
>(function ToolbarLabelSelectTrigger(
  {
    label,
    open = false,
    leadingIcon,
    testID,
    onPress,
    onClick,
    accessibilityLabel,
    accessibilityRole: _accessibilityRole,
    className,
    ...props
  },
  ref,
) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) onPress?.();
    },
    [onClick, onPress],
  );
  return (
    <button
      type="button"
      {...props}
      ref={ref}
      data-testid={testID}
      aria-label={accessibilityLabel}
      data-state={open ? "open" : "closed"}
      onClick={handleClick}
      className={cn(TOOLBAR_LABEL_TRIGGER_CLASS, "disabled:pointer-events-none", className)}
    >
      {leadingIcon ? <ToolbarLabelTriggerIcon>{leadingIcon}</ToolbarLabelTriggerIcon> : null}
      <span className={TOOLBAR_LABEL_TRIGGER_TEXT}>{label}</span>
      <ToolbarLabelTriggerIcon>
        <ChevronDown size={12} className="text-extra-muted-foreground" />
      </ToolbarLabelTriggerIcon>
    </button>
  );
});
