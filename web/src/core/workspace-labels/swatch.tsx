// Port of archive/expo-app:packages/app/src/workspace-labels/swatch.tsx: a label's colour as a dot and as the swatch row it is picked from; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/workspace-label-swatch.py; edit it directly.
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useCallback, useMemo, type CSSProperties, type ReactElement } from "react";
import {
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "@bytetrue/protocol/workspace-labels";
import { identityForeground } from "@/styles/identity-colors";
import { i18n } from "@/i18n/i18next";
import type { Theme } from "@/styles/theme";
import { useThemeObject } from "~/app/theme-object";

/**
 * A label's color as ink: the dot in front of its name, the swatches you pick it from, and the
 * tint mapping the sidebar's label group headers hand to a glyph.
 *
 * The ten names are the identity table's ten (`@/styles/identity-colors`) — the protocol happens
 * to spell them out again as `WorkspaceLabelColor`, and every `identityForeground` call below is
 * the compile-time proof that the two lists still agree. Nothing here picks a hex: a label sits
 * on the same sidebar row as a host badge and a CI check, and the identity table is the one place
 * that holds all three to a single contrast band.
 */

/** The fill of one label colour in the active scheme. */
function useFillStyle(color: WorkspaceLabelColor): CSSProperties {
  const scheme = useThemeObject().colorScheme;
  return useMemo(() => ({ backgroundColor: identityForeground(color, scheme) }), [color, scheme]);
}

export function workspaceLabelColorName(color: WorkspaceLabelColor): string {
  return i18n.t(`workspaceLabels.colors.${color}`);
}

/**
 * One mapping per color for the life of the module, for lucide glyphs that carry a label's
 * color through `withTheme`. The scheme is read inside the mapping, so switching themes repaints
 * the glyph.
 */
export const WORKSPACE_LABEL_ICON_MAPPINGS: Record<
  WorkspaceLabelColor,
  (theme: Theme) => { color: string }
> = Object.fromEntries(
  WORKSPACE_LABEL_COLORS.map((color) => [
    color,
    (theme: Theme) => ({ color: identityForeground(color, theme.colorScheme) }),
  ]),
) as Record<WorkspaceLabelColor, (theme: Theme) => { color: string }>;

/** The mark that stands in for a label wherever its name is already spelled out beside it. */
export function WorkspaceLabelDot({ color }: { color: WorkspaceLabelColor }): ReactElement {
  // 10px: matches the status dot next to it in a menu row, small enough to mark, not to rank.
  return <span className="size-2.5 shrink-0 rounded-full" style={useFillStyle(color)} />;
}

/**
 * The ten colors a label can take, as one row of swatches.
 *
 * The swatch is the whole visual — the 44pt target comes from `hitSlop` growing outward, so the
 * row's rhythm is set by the swatches themselves rather than by ten touch targets with color
 * somewhere inside them. Selection is an inset ring, which React Native draws inside the box, so
 * picking a color cannot reflow the row.
 */
export function WorkspaceLabelSwatchRow({
  value,
  onChange,
  disabled = false,
  testID,
}: {
  value: WorkspaceLabelColor | null;
  onChange: (color: WorkspaceLabelColor) => void;
  disabled?: boolean;
  testID?: string;
}): ReactElement {
  const handleValueChange = useCallback(
    (next: string) => {
      // A single toggle group reports "" when the pressed item is pressed again; a colour stays.
      if (next) onChange(next as WorkspaceLabelColor);
    },
    [onChange],
  );
  return (
    <ToggleGroup
      type="single"
      value={value ?? ""}
      onValueChange={handleValueChange}
      disabled={disabled}
      spacing={2}
      className="flex-wrap"
      data-testid={testID}
    >
      {WORKSPACE_LABEL_COLORS.map((color) => (
        <WorkspaceLabelSwatch key={color} color={color} />
      ))}
    </ToggleGroup>
  );
}

function WorkspaceLabelSwatch({ color }: { color: WorkspaceLabelColor }): ReactElement {
  return (
    <ToggleGroupItem
      value={color}
      size="sm"
      aria-label={workspaceLabelColorName(color)}
      data-testid={`workspace-label-swatch-${color}`}
    >
      <span className="size-4 rounded-full" style={useFillStyle(color)} />
    </ToggleGroupItem>
  );
}
