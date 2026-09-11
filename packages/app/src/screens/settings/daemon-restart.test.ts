import { describe, expect, it } from "vitest";
import { restartDaemonFromSettings, type SettingsDaemonRestartDeps } from "./daemon-restart";

describe("restartDaemonFromSettings", () => {
  it("always restarts through the server RPC", async () => {
    const calls: string[] = [];
    const deps: SettingsDaemonRestartDeps = {
      restartServer: async (reason) => {
        calls.push(`rpc-restart:${reason}`);
      },
    };

    await restartDaemonFromSettings("srv_local", "settings_daemon_restart_srv_local", deps);

    expect(calls).toEqual(["rpc-restart:settings_daemon_restart_srv_local"]);
  });
});
