// Port of archive/expo-app:packages/app/src/composer/agent-controls/option-control.tsx: a composer control that
// opens a list — the glyph trigger plus a combobox anchored to it, owning the open state and the
// select-then-close handshake. Mode, thinking, role and select-type features are all this.
import { useCallback, useRef, useState, type ReactElement } from "react";
import type { AgentControlIcon } from "@/agent-controls/icons";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import type { ShortcutKey } from "@/utils/format-shortcut";

export interface ComposerOptionControlProps {
  icon: AgentControlIcon;
  iconColor?: string;
  surface: "toolbar" | "sheet";
  label: string;
  value?: string;
  showToolbarLabel?: boolean;
  showCaret?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  /** Desktop hover hint. The trigger is the tooltip's anchor. */
  hint?: string;
  /** Keyboard chord shown after the hint, e.g. the mode-cycle shortcut. */
  hintShortcut?: ShortcutKey[][] | null;
  options: ComboboxOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  searchable?: boolean;
  header?: SheetHeader;
  title?: string;
  desktopMinWidth?: number;
  renderOption?: ComboboxProps["renderOption"];
  presentation?: ComboboxProps["presentation"];
  /** Controlled open. Omit both `open` and `onOpenChange` to self-manage. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Fires on open → closed only, so a controller can restore focus once. */
  onClose?: () => void;
}

export function ComposerOptionControl({
  icon,
  iconColor,
  surface,
  label,
  value,
  showToolbarLabel,
  showCaret,
  disabled = false,
  accessibilityLabel,
  testID,
  hint,
  hintShortcut,
  options,
  selectedId,
  onSelect,
  searchable,
  header,
  title,
  desktopMinWidth,
  renderOption,
  presentation,
  open: controlledOpen,
  onOpenChange,
  onClose,
}: ComposerOptionControlProps): ReactElement {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  // Tracks the state a transition is measured against. Seeded from the resolved
  // open so a controlled control knows it is open: its parent owns the prop and
  // this hook never saw an open transition.
  const openRef = useRef(open);
  openRef.current = open;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      const wasOpen = openRef.current;
      // The combobox reports its own close after a selection, so the same
      // transition can arrive twice. Only the first one is a transition.
      if (wasOpen === next) return;
      openRef.current = next;
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
      if (!next) onClose?.();
    },
    [isControlled, onClose, onOpenChange],
  );
  const handlePress = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      handleOpenChange(false);
    },
    [handleOpenChange, onSelect],
  );
  const trigger = (
    <AgentControlTrigger
      ref={anchorRef}
      icon={icon}
      iconColor={iconColor}
      surface={surface}
      label={label}
      value={value}
      showToolbarLabel={showToolbarLabel}
      showCaret={showCaret}
      open={open}
      disabled={disabled}
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    />
  );
  return (
    <>
      {hint ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <span className="flex items-center gap-2">
              <span>{hint}</span>
              {hintShortcut ? <Shortcut chord={hintShortcut} /> : null}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <Combobox
        options={options}
        value={selectedId}
        onSelect={handleSelect}
        searchable={searchable}
        header={header}
        title={title}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={desktopMinWidth}
        renderOption={renderOption}
        presentation={presentation}
      />
    </>
  );
}
