export function shouldUseCompactExplorerKeyboardPadding(input: {
  isGit: boolean;
  explorerTab: "changes" | "files" | "pr";
}): boolean {
  return !input.isGit || input.explorerTab !== "changes";
}

export function resolveKeyboardShift(input: {
  rawKeyboardHeight: number;
  keyboardProgress: number;
  bottomInset: number;
}): number {
  "worklet";

  if (!(input.keyboardProgress > 0) || !(input.rawKeyboardHeight > 0)) {
    return 0;
  }

  return Math.max(0, input.rawKeyboardHeight - input.bottomInset);
}
