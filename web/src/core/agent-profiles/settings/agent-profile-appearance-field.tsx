// Icon and colour in one shadcn Popover: a ToggleGroup of colours above, a ToggleGroup of icons
// redrawn in the chosen colour below. A colour keeps the popover open; an icon commits and closes.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronDown } from "lucide-react";
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
import { ICON_SIZE } from "@/styles/theme";
import { Field, FieldLabel } from "~/components/ui/field";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Separator } from "~/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

/** The icon group's value for "no icon" (ToggleGroup values are strings). */
const DEFAULT_ICON = "default";

/** Colours are named in host appearance; profiles reuse both the palette and its labels. */
function colorLabel(t: TFunction, color: AgentProfileColor): string {
  return t(`settings.host.appearance.color.options.${color}`);
}

function IconCell({
  iconKey,
  color,
}: {
  iconKey: AgentProfileIconKey | null;
  color: AgentProfileColor;
}) {
  return (
    <ToggleGroupItem
      value={iconKey ?? DEFAULT_ICON}
      size="lg"
      aria-label={iconKey ?? "default"}
      data-testid={`agent-profile-icon-cell-${iconKey ?? "default"}`}
    >
      <AgentProfileGlyph
        {...(iconKey ? { icon: iconKey } : {})}
        color={color}
        size={ICON_SIZE.lg}
      />
    </ToggleGroupItem>
  );
}

function ColorCell({ color }: { color: AgentProfileColor }) {
  const { t } = useTranslation();
  const swatchColor = useAgentProfileColorValue(color);
  const swatchStyle = useMemo(
    () => (color === "none" ? undefined : { backgroundColor: swatchColor }),
    [color, swatchColor],
  );
  return (
    <ToggleGroupItem
      value={color}
      size="sm"
      aria-label={colorLabel(t, color)}
      data-testid={`agent-profile-color-cell-${color}`}
    >
      <span className="size-4 rounded-full border bg-muted" style={swatchStyle} />
    </ToggleGroupItem>
  );
}

export function AgentProfileAppearanceField({
  label,
  icon,
  color,
  onChange,
  disabled = false,
  testID,
  triggerTestID,
}: {
  label: string;
  icon: string;
  color: string;
  onChange: (next: { icon: string; color: string }) => void;
  disabled?: boolean;
  testID?: string;
  triggerTestID?: string;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectedIcon = resolveAgentProfileIconKey(icon);
  const selectedColor = resolveAgentProfileColor(color);
  const handleColorChange = useCallback(
    (next: string) => {
      // A single toggle group reports "" when the pressed item is pressed again; keep the colour.
      if (next) onChange({ icon, color: next === "none" ? "" : next });
    },
    [icon, onChange],
  );
  const handleIconChange = useCallback(
    (next: string) => {
      if (next) onChange({ icon: next === DEFAULT_ICON ? "" : next, color });
      setOpen(false);
    },
    [color, onChange],
  );
  return (
    <Field data-testid={testID}>
      <FieldLabel>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="self-start"
            disabled={disabled}
            aria-label={`${label} (${colorLabel(t, selectedColor)})`}
            data-testid={triggerTestID}
          >
            <AgentProfileGlyph
              {...(selectedIcon ? { icon: selectedIcon } : {})}
              color={selectedColor}
              size={ICON_SIZE.md}
            />
            <ChevronDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto"
          data-testid="agent-profile-appearance-picker"
        >
          <ToggleGroup
            type="single"
            value={selectedColor}
            onValueChange={handleColorChange}
            spacing={1}
            className="max-w-56 flex-wrap"
          >
            {AGENT_PROFILE_COLORS.map((option) => (
              <ColorCell key={option} color={option} />
            ))}
          </ToggleGroup>
          <Separator />
          <ToggleGroup
            type="single"
            value={selectedIcon ?? DEFAULT_ICON}
            onValueChange={handleIconChange}
            spacing={1}
            className="grid grid-cols-5"
          >
            <IconCell iconKey={null} color={selectedColor} />
            {AGENT_PROFILE_ICON_KEYS.map((key) => (
              <IconCell key={key} iconKey={key} color={selectedColor} />
            ))}
          </ToggleGroup>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
