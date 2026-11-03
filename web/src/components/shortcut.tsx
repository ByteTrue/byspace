import { normalizeDisplayChord } from "@/components/ui/normalize-display-chord";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { Kbd, KbdGroup } from "~/components/ui/kbd";

/** The Expo app's Shortcut on shadcn's Kbd: one key cap per combo, nothing when keys are unavailable. */
export function Shortcut({
  keys,
  chord,
}: {
  keys?: ShortcutKey[];
  chord?: ShortcutKey[][] | null;
}) {
  const available = useKeyboardShortcutsAvailable();
  const displayChord = normalizeDisplayChord(chord ?? undefined, keys);
  if (!available || !displayChord?.[0]) return null;
  const os = getShortcutOs();
  if (displayChord.length === 1) return <Kbd>{formatShortcut(displayChord[0], os)}</Kbd>;
  return (
    <KbdGroup>
      {displayChord.map((combo) => (
        <Kbd key={combo.join("+")}>{formatShortcut(combo, os)}</Kbd>
      ))}
    </KbdGroup>
  );
}
