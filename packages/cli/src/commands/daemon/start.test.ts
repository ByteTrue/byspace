import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const startLocalDaemonDetached = vi.hoisted(() => vi.fn());

vi.mock("./local-daemon.js", () => ({
  runLocalDaemonForeground: vi.fn(),
  startLocalDaemonDetached,
}));

import { runStart } from "./start.js";

describe("daemon start output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    startLocalDaemonDetached.mockReset();
  });

  it("offers the configured local and hosted web apps", async () => {
    startLocalDaemonDetached.mockResolvedValue({
      pid: 4242,
      logPath: "/tmp/byspace/daemon.log",
      webUiUrl: "http://localhost:6777/",
      hostedWebUrl: "https://web.example.test",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const command = new Command().exitOverride();
    runStart(command);

    await command.parseAsync(["node", "byspace", "start"]);

    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("Local Web UI is running.\nOpen BySpace using either:");
    expect(output).toContain("Local:  http://localhost:6777/");
    expect(output).toContain("Hosted: https://web.example.test");
  });
});
