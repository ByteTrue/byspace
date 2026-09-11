/** Resident webview registry shim (Electron retired, issue 025 A3). */
export function getResidentBrowserWebview(): null {
  return null;
}

export function removeResidentBrowserWebview(_browserId: string): void {}
