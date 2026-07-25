import { describe, expect, it } from "vitest";
import type { WorkspaceScriptPayload } from "@bytetrue/byspace-protocol/messages";
import type { ActiveConnection } from "@/runtime/host-runtime";
import { resolveWorkspaceScriptLink } from "./workspace-script-links";

const runningService: WorkspaceScriptPayload = {
  scriptName: "web",
  type: "service",
  hostname: "web--feature--byspace.localhost",
  port: 3000,
  localProxyUrl: "http://web--feature--byspace.localhost:6777",
  publicProxyUrl: null,
  proxyUrl: "http://web--feature--byspace.localhost:6777",
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
  it("defaults to the memorable BySpace URL locally and keeps direct as a fallback", () => {
    expect(
      resolveLink({ type: "directTcp", endpoint: "localhost:6777", display: "localhost:6777" }),
    ).toEqual({
      primary: {
        kind: "byspace",
        label: "web--feature--byspace.localhost:6777",
        url: "http://web--feature--byspace.localhost:6777",
      },
      targets: [
        {
          kind: "byspace",
          label: "web--feature--byspace.localhost:6777",
          url: "http://web--feature--byspace.localhost:6777",
        },
        { kind: "direct", label: "localhost:3000", url: "http://localhost:3000" },
      ],
    });
  });

  it("defaults to an explicitly configured reverse proxy", () => {
    const publicUrl = "https://web--feature--byspace.services.example.com";
    expect(
      resolveLink(
        { type: "directTcp", endpoint: "127.0.0.1:6777", display: "direct" },
        { ...runningService, publicProxyUrl: publicUrl, proxyUrl: publicUrl },
      ),
    ).toEqual({
      primary: {
        kind: "public",
        label: "web--feature--byspace.services.example.com",
        url: publicUrl,
      },
      targets: [
        {
          kind: "public",
          label: "web--feature--byspace.services.example.com",
          url: publicUrl,
        },
        {
          kind: "byspace",
          label: "web--feature--byspace.localhost:6777",
          url: "http://web--feature--byspace.localhost:6777",
        },
        { kind: "direct", label: "localhost:3000", url: "http://localhost:3000" },
      ],
    });
  });

  it("uses the daemon host and service port over a direct network connection", () => {
    expect(
      resolveLink({
        type: "directTcp",
        endpoint: "mac-mini.tail123.ts.net:6777",
        display: "mac-mini.tail123.ts.net:6777",
      }),
    ).toEqual({
      primary: {
        kind: "direct",
        label: "mac-mini.tail123.ts.net:3000",
        url: "http://mac-mini.tail123.ts.net:3000",
      },
      targets: [
        {
          kind: "direct",
          label: "mac-mini.tail123.ts.net:3000",
          url: "http://mac-mini.tail123.ts.net:3000",
        },
      ],
    });
  });

  it("offers the reverse proxy and direct route over a direct network connection", () => {
    const publicUrl = "https://web--feature--byspace.services.example.com";
    expect(
      resolveLink(
        { type: "directTcp", endpoint: "mac-mini.tail123.ts.net:6777", display: "remote" },
        { ...runningService, publicProxyUrl: publicUrl, proxyUrl: publicUrl },
      ).targets,
    ).toEqual([
      { kind: "public", label: "web--feature--byspace.services.example.com", url: publicUrl },
      {
        kind: "direct",
        label: "mac-mini.tail123.ts.net:3000",
        url: "http://mac-mini.tail123.ts.net:3000",
      },
    ]);
  });

  it("only exposes public routes over a relay connection", () => {
    const relay: ActiveConnection = {
      type: "relay",
      endpoint: "relay.byspace.sh:443",
      display: "relay",
    };
    expect(resolveLink(relay)).toEqual({ primary: null, targets: [] });

    const publicUrl = "https://web--feature--byspace.services.example.com";
    expect(
      resolveLink(relay, { ...runningService, publicProxyUrl: publicUrl, proxyUrl: publicUrl }),
    ).toEqual({
      primary: {
        kind: "public",
        label: "web--feature--byspace.services.example.com",
        url: publicUrl,
      },
      targets: [
        {
          kind: "public",
          label: "web--feature--byspace.services.example.com",
          url: publicUrl,
        },
      ],
    });
  });

  it("classifies proxyUrl from older daemons", () => {
    const { localProxyUrl: _local, publicProxyUrl: _public, ...legacyLocal } = runningService;
    expect(resolveLink(null, legacyLocal).targets).toEqual([]);

    const publicUrl = "https://web--feature--byspace.services.example.com";
    expect(
      resolveLink(
        { type: "relay", endpoint: "relay.byspace.sh:443", display: "relay" },
        { ...legacyLocal, proxyUrl: publicUrl },
      ).primary,
    ).toEqual({
      kind: "public",
      label: "web--feature--byspace.services.example.com",
      url: publicUrl,
    });
  });

  it("has no routes for stopped services or plain scripts", () => {
    expect(resolveLink(null, { ...runningService, lifecycle: "stopped" })).toEqual({
      primary: null,
      targets: [],
    });
    expect(resolveLink(null, { ...runningService, type: "script" })).toEqual({
      primary: null,
      targets: [],
    });
  });
});
