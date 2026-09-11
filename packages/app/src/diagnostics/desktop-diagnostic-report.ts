/** Desktop diagnostics shim (Electron retired, issue 025 A3). */
export interface DesktopDiagnosticResult {
  sections: [];
  status: "done";
}

export function collectDesktopDiagnosticSections(): Promise<DesktopDiagnosticResult> {
  return Promise.resolve({ sections: [], status: "done" });
}
