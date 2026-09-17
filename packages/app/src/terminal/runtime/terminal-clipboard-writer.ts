/**
 * Clipboard sink used by the terminal selection-copy path.
 *
 * Terminal selection used to live in `terminal/native-renderer/` (native grid
 * renderer, retired with native mobile). Only the copy path survives on web, so
 * the writer type lives here; the native renderer's other modules are gone.
 */
export interface TerminalClipboardWriter {
  writeText: (text: string) => Promise<void>;
}
