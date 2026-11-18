import { describe, expect, it } from "vitest";
import type { WorkspaceScriptPayload } from "@bytetrue/protocol/messages";
import type { ActiveConnection } from "@/runtime/host-runtime";
import { resolveWorkspaceScriptLink } from "./workspace-script-links";

const runningService: WorkspaceScriptPayload = {
  scriptName: "web",
  type: "service",
  port: 3000,
  lifecycle: "running",
  health: "healthy",
  exitCode: null,
  terminalId: null,
};

function resolveLink(
  activeConnection: ActiveConnection | null,
  script: WorkspaceScriptPayload = runningService,
) {
  return resolveWorkspaceScriptLink({ script, activeConnection });
}

describe("resolveWorkspaceScriptLink", () => {
  it("links to localhost when there is no direct connection", () => {
    expect(resolveLink(null)).toEqual({ label: "localhost:3000", url: "http://localhost:3000" });
    expect(
      resolveLink({ type: "relay", endpoint: "relay.byspace.cc.cd:443", display: "relay" }),
    ).toEqual({ label: "localhost:3000", url: "http://localhost:3000" });
  });

  it("uses the daemon host and service port over a direct network connection", () => {
    expect(
      resolveLink({
        type: "directTcp",
        endpoint: "mac-mini.tail123.ts.net:6767",
        display: "mac-mini.tail123.ts.net:6767",
      }),
    ).toEqual({
      label: "mac-mini.tail123.ts.net:3000",
      url: "http://mac-mini.tail123.ts.net:3000",
    });
  });

  it("normalizes loopback and brackets IPv6 hosts", () => {
    expect(
      resolveLink({ type: "directTcp", endpoint: "127.0.0.1:6767", display: "local" }),
    ).toEqual({ label: "localhost:3000", url: "http://localhost:3000" });
    expect(resolveLink({ type: "directTcp", endpoint: "[::1]:6767", display: "local" })).toEqual({
      label: "localhost:3000",
      url: "http://localhost:3000",
    });
    expect(
      resolveLink({ type: "directTcp", endpoint: "[2001:db8::1]:6767", display: "remote" }),
    ).toEqual({
      label: "[2001:db8::1]:3000",
      url: "http://[2001:db8::1]:3000",
    });
  });

  it("has no link for stopped services, plain scripts, or a missing port", () => {
    expect(resolveLink(null, { ...runningService, lifecycle: "stopped" })).toBeNull();
    expect(resolveLink(null, { ...runningService, type: "script" })).toBeNull();
    expect(resolveLink(null, { ...runningService, port: null })).toBeNull();
  });
});
