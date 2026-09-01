const DEFAULT_TERMINAL_FONT_SIZE = 14;

// Keep this standalone from the app theme module: it is bundled into the isolated WebView.
export const DEFAULT_TERMINAL_FONT_FAMILY = [
  // Browser-visible system monospace first; named fonts and Nerd glyphs are fallbacks.
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  "'Cascadia Mono'",
  "'DejaVu Sans Mono'",
  "'Liberation Mono'",
  "'JetBrainsMono Nerd Font'",
  "'Symbols Nerd Font'",
  "monospace",
].join(", ");

export function resolveTerminalFontFamily(fontFamily: string | undefined): string {
  const trimmed = fontFamily?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_TERMINAL_FONT_FAMILY;
}

export function resolveTerminalFontSize(fontSize: number | undefined): number {
  return typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_TERMINAL_FONT_SIZE;
}
