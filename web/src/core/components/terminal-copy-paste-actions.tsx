// Port of archive/expo-app:packages/app/src/components/terminal-copy-paste-actions.tsx: the terminal's Paste key
// and the floating Copy button shown over a selection on a phone.
import { useCallback, useMemo, type CSSProperties } from "react";
import { cn } from "cn";
import { useThemeObject } from "~/app/theme-object";

export interface TerminalPasteActionProps {
  hasClipboardText: boolean;
  onPaste: () => void;
}

export function TerminalPasteAction({ hasClipboardText, onPaste }: TerminalPasteActionProps) {
  return (
    <TerminalActionButton
      label="Paste"
      testID="terminal-paste"
      disabled={!hasClipboardText}
      onPress={onPaste}
      variant="key"
    />
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
    <TerminalActionButton label="Copy" testID="terminal-copy" onPress={onCopy} variant="floating" />
  );
}

const KEY_CLASS_NAME =
  "flex h-[34px] min-w-0 flex-1 items-center justify-center rounded-md border border-(--key-border) bg-(--key-surface) px-1 text-sm font-medium text-(--key-text) hover:bg-(--key-surface-hovered) disabled:opacity-45 disabled:hover:bg-(--key-surface)";
const FLOATING_CLASS_NAME =
  "rounded-lg bg-[rgba(32,32,32,0.86)] px-3 py-1 text-xs font-medium text-[#f5f5f5] hover:bg-[rgba(48,48,48,0.92)]";

function TerminalActionButton({
  label,
  testID,
  disabled = false,
  onPress,
  variant,
}: {
  label: string;
  testID: string;
  disabled?: boolean;
  onPress: () => void;
  variant: "key" | "floating";
}) {
  const theme = useThemeObject();
  // The key sits in the terminal's key rows and takes the app's surface colors, as in the Expo app.
  const keyStyle = useMemo(
    () =>
      ({
        "--key-border": theme.colors.border,
        "--key-surface": theme.colors.surface1,
        "--key-surface-hovered": theme.colors.surface2,
        "--key-text": theme.colors.foregroundMuted,
      }) as CSSProperties,
    [theme],
  );
  const handlePress = useCallback(() => {
    if (!disabled) onPress();
  }, [disabled, onPress]);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      data-testid={testID}
      onClick={handlePress}
      style={variant === "key" ? keyStyle : undefined}
      className={cn(variant === "key" ? KEY_CLASS_NAME : FLOATING_CLASS_NAME)}
    >
      {label}
    </button>
  );
}
