"""Port packages/app's workspace-labels/swatch.tsx to web/src/overrides: a label's colour as the
10px dot in front of its name and the row of 20px swatches it is picked from. Same exports; the
fills read the active scheme from the theme object instead of a registered stylesheet."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("workspace-labels/swatch.tsx")
p.rep('''import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
''', '''import { useCallback, useMemo, type CSSProperties, type ReactElement } from "react";
''')
p.rep('''import type { Theme } from "@/styles/theme";
''', '''import type { Theme } from "@/styles/theme";
import { cn } from "cn";
import { useThemeObject } from "~/app/theme-object";
''')
p.rep('''/** Matches the status dot next to it in a menu row: small enough to mark, not to rank. */
const DOT_SIZE = 10;

/** Big enough to judge a color by, and the swatch grid's only unit — see `hitSlop` below. */
const SWATCH_SIZE = 20;

''', '''/** The fill of one label colour in the active scheme. */
function useFillStyle(color: WorkspaceLabelColor): CSSProperties {
  const scheme = useThemeObject().colorScheme;
  return useMemo(() => ({ backgroundColor: identityForeground(color, scheme) }), [color, scheme]);
}

''')
p.rep('''export function WorkspaceLabelDot({ color }: { color: WorkspaceLabelColor }): ReactElement {
  return <View style={[styles.dot, fillStyle(color)]} />;
}''', '''export function WorkspaceLabelDot({ color }: { color: WorkspaceLabelColor }): ReactElement {
  // 10px: matches the status dot next to it in a menu row, small enough to mark, not to rank.
  return <span className="size-2.5 shrink-0 rounded-full" style={useFillStyle(color)} />;
}''')
p.rep('''    <View style={styles.swatchRow} testID={testID}>''',
      '''    <div className="flex flex-row flex-wrap items-center gap-3" role="radiogroup" data-testid={testID}>''')
p.rep('''      ))}
    </View>
  );
}''', '''      ))}
    </div>
  );
}''')
p.rep('''  const select = useCallback(() => onChange(color), [color, onChange]);
  const accessibilityState = useMemo(() => ({ checked: selected, disabled }), [disabled, selected]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={workspaceLabelColorName(color)}
      accessibilityState={accessibilityState}
      aria-checked={selected}
      disabled={disabled}
      hitSlop={SWATCH_HIT_SLOP}
      onPress={select}
      style={[styles.swatch, fillStyle(color), selected && styles.swatchSelected]}
      testID={`workspace-label-swatch-${color}`}
    />
  );
}

// Grows the 20pt swatch to a 44pt target without moving it. Padding here would push its
// neighbours apart and leave the row's spacing to the touch targets rather than the color.
const SWATCH_HIT_SLOP = (44 - SWATCH_SIZE) / 2;
''', '''  const select = useCallback(() => onChange(color), [color, onChange]);
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
''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("a label's colour as a dot and as the swatch row it is picked from; DOM view.",
        "workspace-label-swatch.py")
