/**
 * A closing menu hands focus back to its trigger, unless what the menu did already moved focus
 * (a "New agent" item focusing the new composer); then focus stays there. For a shadcn menu's
 * `onCloseAutoFocus`.
 */
export function keepFocusElsewhere(event: Event): void {
  const active = document.activeElement;
  if (active && active !== document.body) event.preventDefault();
}
