import type { SubscribeTerminalRequest } from "@getpaseo/protocol/messages";

export const TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES = 1_000;

export interface ResolveTerminalRestoreOptionsInput {
  supportsTerminalRestoreModes: boolean;
  canClaimSize: boolean;
  canResume: boolean;
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
    resume: input.canResume,
    scrollbackLines: TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES,
    ...(input.canClaimSize && input.size ? { size: input.size } : {}),
  };
}
