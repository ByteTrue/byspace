export function handleMenuSheetEscape(event: KeyboardEvent, close: () => void): boolean {
  if (event.key !== "Escape") return false;
  event.preventDefault();
  event.stopPropagation();
  close();
  return true;
}
