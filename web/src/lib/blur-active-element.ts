/** Takes focus out of the focused field, which also closes a phone's on-screen keyboard. */
export function blurActiveElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}
