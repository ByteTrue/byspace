/** Daemon status hook shim (Electron retired, issue 025 A3). */
export function useDaemonStatus() {
  return { status: null as null, isRunning: false, isLoading: false };
}
