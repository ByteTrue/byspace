/**
 * Desktop-managed daemon shim (Electron retired, issue 025 A3).
 *
 * There is no desktop shell to manage a daemon. Status reports "not
 * available"; start/stop/restart reject because nothing can own a daemon
 * process on the web client. Users run daemons with `byspace daemon start`.
 */

export interface DesktopDaemonStatus {
  state: "unavailable";
  status: "running" | "stopped" | "unavailable";
  serverId: string;
  version: string | null;
  listen: string | null;
  hostname: string | null;
  pid: number | null;
  home: string | null;
  desktopManaged: boolean;
  error: string | null;
}

export interface DesktopDaemonLogs {
  contents: string;
  logPath: string | null;
}

export async function getDesktopDaemonStatus(): Promise<DesktopDaemonStatus> {
  return {
    state: "unavailable",
    status: "unavailable",
    serverId: "",
    version: null,
    listen: null,
    hostname: null,
    pid: null,
    home: null,
    desktopManaged: false,
    error: null,
  };
}

export function shouldUseDesktopDaemon(): false {
  return false;
}

export async function getDesktopDaemonLogs(): Promise<DesktopDaemonLogs> {
  return { contents: "", logPath: null };
}

export async function startDesktopDaemon(): Promise<DesktopDaemonStatus> {
  throw new Error("The desktop-managed daemon is retired. Run 'byspace daemon start' instead.");
}

export async function stopDesktopDaemon(): Promise<void> {}

export async function restartDesktopDaemon(): Promise<DesktopDaemonStatus> {
  throw new Error("The desktop-managed daemon is retired. Run 'byspace daemon start' instead.");
}
