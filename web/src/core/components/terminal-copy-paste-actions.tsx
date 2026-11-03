// The terminal's Paste key (an outline Button in the key rows) and the floating Copy button shown
// over a selection on a phone (a secondary Button).
import { Button } from "~/components/ui/button";

export interface TerminalPasteActionProps {
  hasClipboardText: boolean;
  onPaste: () => void;
}

export function TerminalPasteAction({ hasClipboardText, onPaste }: TerminalPasteActionProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className="min-w-0 flex-1"
      aria-label="Paste"
      data-testid="terminal-paste"
      disabled={!hasClipboardText}
      onClick={onPaste}
    >
      Paste
    </Button>
  );
}

export interface TerminalFloatingCopyActionProps {
  hasSelection: boolean;
  onCopy: () => void;
}

export function TerminalFloatingCopyAction({
  hasSelection,
  onCopy,
}: TerminalFloatingCopyActionProps) {
  if (!hasSelection) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label="Copy"
      data-testid="terminal-copy"
      onClick={onCopy}
    >
      Copy
    </Button>
  );
}
