// Port of packages/app/src/components/ui/shortcut.tsx: shadcn key caps (web/src/components/shortcut).
import type { ShortcutKey } from "@/utils/format-shortcut";
import { Shortcut as KbdShortcut } from "~/components/shortcut";

export function Shortcut({
  keys,
  chord,
}: {
  keys?: ShortcutKey[];
  chord?: ShortcutKey[][] | null;
  style?: unknown;
  textStyle?: unknown;
}) {
  return <KbdShortcut keys={keys} chord={chord} />;
}
