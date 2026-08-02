import type { SubscribeTerminalRequest } from "@bytetrue/byspace-protocol/messages";

// Matches what the daemon's headless xterm actually retains (`scrollback: 1000`): asking for
// less silently threw away history the daemon still had, because the replay resets the renderer
// first. Measured cost of the wider replay is in `packages/app/e2e/terminal-restore-window.spec.ts`.
export const TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES = 1_000;

export interface ResolveTerminalRestoreOptionsInput {
  supportsTerminalRestoreModes: boolean;
  size: { rows: number; cols: number } | null;
}

export function resolveTerminalRestoreOptions(
  input: ResolveTerminalRestoreOptionsInput,
): SubscribeTerminalRequest["restore"] | undefined {
  if (!input.supportsTerminalRestoreModes) {
    return undefined;
  }

  return {
    mode: "visible-snapshot",
    scrollbackLines: TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES,
    ...(input.size ? { size: input.size } : {}),
  };
}
