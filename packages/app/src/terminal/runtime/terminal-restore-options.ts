import type { SubscribeTerminalRequest } from "@bytetrue/byspace-protocol/messages";

// Matches what the daemon's headless xterm actually retains (`scrollback: 1000`): asking for
// less silently threw away history the daemon still had, because the replay resets the renderer
// first. Measured cost of the wider replay is in `packages/app/e2e/terminal-restore-window.spec.ts`.
export const TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES = 1_000;

export interface ResolveTerminalRestoreOptionsInput {
  supportsTerminalRestoreModes: boolean;
  size: { rows: number; cols: number } | null;
  /**
   * Whether this renderer still holds this terminal's stream. Only the client
   * can know: the daemon session outlives a page reload, so "I already sent you
   * this" is not the same question as "you still have it".
   */
  canResume: boolean;
}

export function resolveTerminalRestoreOptions(
  input: ResolveTerminalRestoreOptionsInput,
): SubscribeTerminalRequest["restore"] | undefined {
  if (!input.supportsTerminalRestoreModes) {
    return undefined;
  }

  return {
    // The renderer outlives a hidden Terminal, so ask for the gap first: a
    // snapshot replay resets it and throws away scrollback the client still
    // has. `mode` stays as the fallback for a daemon that cannot resume (too
    // much output missed, or a daemon that predates resuming).
    ...(input.canResume ? { resume: true } : {}),
    mode: "visible-snapshot",
    scrollbackLines: TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES,
    ...(input.size ? { size: input.size } : {}),
  };
}
