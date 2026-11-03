// Port of archive/expo-app:packages/app/src/agent-profiles/settings/agent-profile-appearance-field.tsx: icon and
// colour in one popover — the swatch row above, the icon grid redrawn in the chosen colour below.
// A colour keeps the popover open; an icon commits and closes.
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check, ChevronDown } from "lucide-react";
import {
  AgentProfileGlyph,
  useAgentProfileColorValue,
} from "@/agent-profiles/internal/agent-profile-glyph";
import {
  AGENT_PROFILE_COLORS,
  AGENT_PROFILE_ICON_KEYS,
  resolveAgentProfileColor,
  resolveAgentProfileIconKey,
  type AgentProfileColor,
  type AgentProfileIconKey,
} from "@/agent-profiles/internal/profile-appearance";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { ICON_SIZE } from "@/styles/theme";
import { cn } from "cn";
import { Field, FieldLabel } from "~/components/ui/field";

const CELL_SIZE = 40;
const CELL_GAP = 4;
const GRID_COLUMNS = 5;
const CELL_ROW_WIDTH = GRID_COLUMNS * CELL_SIZE + (GRID_COLUMNS - 1) * CELL_GAP;
const CELL_GRID_PADDING = 12;
const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];

/**
 * Locked, not a floor: an unlocked popover stretches to its 400px maximum and
 * the wrapping grid follows it to eight columns. Two spare pixels so a frame
 * border can never push the fifth cell onto its own row.
 */
const DESKTOP_WIDTH = CELL_ROW_WIDTH + CELL_GRID_PADDING * 2 + 2;

/** Colours are named in host appearance; profiles reuse both the palette and its labels. */
function colorLabel(t: TFunction, color: AgentProfileColor): string {
  return t(`settings.host.appearance.color.options.${color}`);
}

function IconCell({
  iconKey,
  selected,
  color,
  onSelect,
}: {
  iconKey: AgentProfileIconKey | null;
  selected: boolean;
  color: AgentProfileColor;
  onSelect: (iconKey: AgentProfileIconKey | null) => void;
}) {
  const handlePress = useCallback(() => onSelect(iconKey), [iconKey, onSelect]);
  return (
    <button
      type="button"
      onClick={handlePress}
      aria-pressed={selected}
      aria-label={iconKey ?? "default"}
      data-testid={`agent-profile-icon-cell-${iconKey ?? "default"}`}
      className={cn(
        "flex size-10 items-center justify-center rounded-md border border-transparent hover:bg-muted active:opacity-70",
        selected && "border-border bg-muted",
      )}
    >
      <AgentProfileGlyph
        {...(iconKey ? { icon: iconKey } : {})}
        color={color}
        size={ICON_SIZE.lg}
      />
    </button>
  );
}

function ColorCell({
  color,
  selected,
  onSelect,
}: {
  color: AgentProfileColor;
  selected: boolean;
  onSelect: (color: AgentProfileColor) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(color), [color, onSelect]);
  const swatchColor = useAgentProfileColorValue(color);
  const swatchStyle = useMemo(
    () => (color === "none" ? undefined : { backgroundColor: swatchColor }),
    [color, swatchColor],
  );
  return (
    <button
      type="button"
      onClick={handlePress}
      aria-pressed={selected}
      aria-label={colorLabel(t, color)}
      data-testid={`agent-profile-color-cell-${color}`}
      className="flex size-8 items-center justify-center rounded-md active:opacity-70"
    >
      <span
        className="flex size-5 items-center justify-center rounded-full border bg-muted"
        style={swatchStyle}
      >
        {selected ? (
          <Check
            size={ICON_SIZE.sm}
            className={color === "none" ? "text-muted-foreground" : "text-background"}
          />
        ) : null}
      </span>
    </button>
  );
}

export function AgentProfileAppearanceField({
  label,
  icon,
  color,
  onChange,
  size = "md",
  disabled = false,
  testID,
  triggerTestID,
}: {
  label: string;
  icon: string;
  color: string;
  onChange: (next: { icon: string; color: string }) => void;
  size?: FieldControlSize;
  disabled?: boolean;
  testID?: string;
  triggerTestID?: string;
}): ReactElement {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedIcon = resolveAgentProfileIconKey(icon);
  const selectedColor = resolveAgentProfileColor(color);
  const handleTriggerPress = useCallback(() => {
    if (!disabled) setOpen((current) => !current);
  }, [disabled]);
  const handleColorSelect = useCallback(
    (next: AgentProfileColor) => onChange({ icon, color: next === "none" ? "" : next }),
    [icon, onChange],
  );
  const handleIconSelect = useCallback(
    (next: AgentProfileIconKey | null) => {
      onChange({ icon: next ?? "", color });
      setOpen(false);
    },
    [color, onChange],
  );
  const header = useMemo(() => ({ title: label }), [label]);
  return (
    <Field data-testid={testID}>
      <FieldLabel>{label}</FieldLabel>
      <button
        ref={anchorRef}
        type="button"
        onClick={handleTriggerPress}
        disabled={disabled}
        aria-label={`${label} (${colorLabel(t, selectedColor)})`}
        aria-expanded={open}
        data-testid={triggerTestID}
        className={cn(
          "flex items-center justify-center gap-1 border border-input bg-transparent px-2 outline-none hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30",
          size === "sm" ? "h-8 rounded-md md:h-7" : "h-11 rounded-lg md:h-8",
          open && "border-ring",
        )}
      >
        <AgentProfileGlyph
          {...(selectedIcon ? { icon: selectedIcon } : {})}
          color={selectedColor}
          size={ICON_SIZE.md}
        />
        <ChevronDown size={ICON_SIZE.sm} className="text-muted-foreground" />
      </button>
      <Combobox
        options={EMPTY_COMBOBOX_OPTIONS}
        value=""
        onSelect={noop}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        header={header}
        desktopMinWidth={DESKTOP_WIDTH}
        desktopLockWidth
      >
        <div className="flex flex-col gap-3 p-3" data-testid="agent-profile-appearance-picker">
          <div className="flex flex-wrap gap-1 border-b pb-3">
            {AGENT_PROFILE_COLORS.map((option) => (
              <ColorCell
                key={option}
                color={option}
                selected={option === selectedColor}
                onSelect={handleColorSelect}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <IconCell
              iconKey={null}
              selected={selectedIcon === null}
              color={selectedColor}
              onSelect={handleIconSelect}
            />
            {AGENT_PROFILE_ICON_KEYS.map((key) => (
              <IconCell
                key={key}
                iconKey={key}
                selected={key === selectedIcon}
                color={selectedColor}
                onSelect={handleIconSelect}
              />
            ))}
          </div>
        </div>
      </Combobox>
    </Field>
  );
}

function noop() {}
