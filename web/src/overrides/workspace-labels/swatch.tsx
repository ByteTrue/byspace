// Override of packages/app/src/workspace-labels/swatch.tsx: a label's colour as a dot and as the swatch row it is picked from; DOM view.
// Generated from the Expo file by web/scripts/port/workspace-label-swatch.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useMemo, type CSSProperties, type ReactElement } from "react";
import {
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "@bytetrue/protocol/workspace-labels";
import { identityForeground } from "@/styles/identity-colors";
import { i18n } from "@/i18n/i18next";
import type { Theme } from "@/styles/theme";
import { cn } from "cn";
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
 * One stable mapping per color for the life of the module, for lucide glyphs that carry a
 * label's color (`withUnistyles` re-subscribes when `uniProps` changes identity). The scheme is
 * read inside the mapping, so switching themes repaints the glyph without a React render.
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
  return (
    <div
      className="flex flex-row flex-wrap items-center gap-3"
      role="radiogroup"
      data-testid={testID}
    >
      {WORKSPACE_LABEL_COLORS.map((color) => (
        <WorkspaceLabelSwatch
          key={color}
          color={color}
          selected={color === value}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function WorkspaceLabelSwatch({
  color,
  selected,
  disabled,
  onChange,
}: {
  color: WorkspaceLabelColor;
  selected: boolean;
  disabled: boolean;
  onChange: (color: WorkspaceLabelColor) => void;
}): ReactElement {
  const select = useCallback(() => onChange(color), [color, onChange]);
  // 20px, big enough to judge a colour by; selection is a 2px foreground border drawn inside
  // the box, so picking a colour cannot reflow the row.
  return (
    <button
      type="button"
      role="radio"
      aria-label={workspaceLabelColorName(color)}
      aria-checked={selected}
      disabled={disabled}
      onClick={select}
      className={cn("size-5 shrink-0 rounded-full", selected && "border-2 border-foreground")}
      style={useFillStyle(color)}
      data-testid={`workspace-label-swatch-${color}`}
    />
  );
}
