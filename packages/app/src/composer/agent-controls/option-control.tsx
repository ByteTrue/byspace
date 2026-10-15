import { useCallback, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import type { AgentControlIcon } from "@/agent-controls/icons";

/**
 * A composer control that opens a list: glyph trigger plus a combobox anchored
 * to it, with the open state and the select-then-close handshake owned here.
 *
 * Every list-shaped composer control is this control with different options —
 * mode, thinking, role, and each select-type agent feature. What still differs
 * is passed in: the options, whether the opener owns the open state because it
 * coordinates siblings, and the hint copy.
 */
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
  const anchorRef = useRef<View>(null);
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
      // transition can arrive twice. Only the first one is a transition: the
      // parent's callback drives focus and sheet state, and running it twice
      // starts duplicate work.
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

  const anchoredTrigger = hint ? (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        {trigger}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{hint}</Text>
          {hintShortcut ? <Shortcut chord={hintShortcut} /> : null}
        </View>
      </TooltipContent>
    </Tooltip>
  ) : (
    trigger
  );

  return (
    <>
      {anchoredTrigger}
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

const styles = StyleSheet.create((theme) => ({
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
