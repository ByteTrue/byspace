// Electron retired (issue 025): the desktop-managed daemon restart path is gone.
// Daemon restarts from settings always go through the server RPC.

export interface SettingsDaemonRestartDeps {
  restartServer: (reason: string) => Promise<unknown>;
}

export async function restartDaemonFromSettings(
  _hostServerId: string,
  reason: string,
  deps: SettingsDaemonRestartDeps,
): Promise<void> {
  await deps.restartServer(reason);
}
