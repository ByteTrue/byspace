/**
 * Browser keyboard policy shim (Electron retired, issue 025 A3).
 *
 * All consumers are gated behind the (permanently false) desktop runtime;
 * these stubs keep the shared keyboard pipeline type-correct on web.
 */

export interface BrowserShortcutPolicy {
  menuPrefixes: readonly string[];
  prefixes: readonly string[];
}

export interface BrowserShortcutInput {
  key: string;
}

export function buildBrowserKeyboardPolicy(_input: {
  bindings: unknown;
  chordState?: unknown;
  isMac: boolean;
  isDesktop: boolean;
}): BrowserShortcutPolicy {
  return { menuPrefixes: [], prefixes: [] };
}

export function parseBrowserShortcutInput(payload: unknown): BrowserShortcutInput {
  const record = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  return { key: typeof record.key === "string" ? record.key : "" };
}

export function shouldPublishBrowserShortcutPolicy(_input: {
  isBrowserInput: boolean;
  previousChordState: unknown;
  nextChordState: unknown;
}): boolean {
  return false;
}
