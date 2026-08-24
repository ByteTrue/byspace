import { describe, expect, test } from "vitest";

import { ServerInfoStatusPayloadSchema } from "./messages.js";

describe("server_info available terminal shells", () => {
  test("accepts the daemon's available shell commands", () => {
    const payload = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      hostname: "host",
      version: "0.6.0",
      availableTerminalShells: ["pwsh.exe", "cmd.exe", "bash"],
    });

    expect(payload.availableTerminalShells).toEqual(["pwsh.exe", "cmd.exe", "bash"]);
  });

  test("rejects shell commands outside the supported candidates", () => {
    expect(() =>
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server-1",
        hostname: "host",
        version: "0.6.0",
        availableTerminalShells: ["fish"],
      }),
    ).toThrow();
  });
});
