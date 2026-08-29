import { describe, expect, it } from "vitest";
import type { ServerCapabilities } from "@bytetrue/byspace-protocol/messages";
import type { DaemonServerInfo } from "@/stores/session-store";
import {
  getDictationReadinessState,
  getServerCapabilities,
  resolveDictationUnavailableMessage,
} from "./server-info-capabilities";

function buildServerInfo(serverCapabilities?: ServerCapabilities): DaemonServerInfo {
  return {
    serverId: "srv-1",
    hostname: "test-host",
    version: "0.1.0",
    ...(serverCapabilities ? { capabilities: serverCapabilities } : {}),
  };
}

function capabilities(dictation: { enabled: boolean; reason: string }): ServerCapabilities {
  return {
    voice: {
      dictation,
      // COMPAT(voiceMode): old daemons and protocol schemas still include this field.
      voice: { enabled: false, reason: "Voice mode has been removed." },
    },
  };
}

describe("server-info-capabilities", () => {
  it("returns null when server_info omits capability metadata", () => {
    const serverInfo = buildServerInfo();
    expect(getServerCapabilities({ serverInfo })).toBeNull();
    expect(getDictationReadinessState({ serverInfo })).toBeNull();
  });

  it("returns dictation readiness", () => {
    const value = capabilities({ enabled: true, reason: "Dictation is warming up." });
    expect(getDictationReadinessState({ serverInfo: buildServerInfo(value) })).toEqual(
      value.voice?.dictation,
    );
  });

  it("returns the nonblank unavailable reason", () => {
    expect(
      resolveDictationUnavailableMessage({
        serverInfo: buildServerInfo(capabilities({ enabled: false, reason: "Select a model." })),
      }),
    ).toBe("Select a model.");
    expect(
      resolveDictationUnavailableMessage({
        serverInfo: buildServerInfo(capabilities({ enabled: true, reason: "" })),
      }),
    ).toBeNull();
    expect(
      resolveDictationUnavailableMessage({
        serverInfo: buildServerInfo(capabilities({ enabled: false, reason: "   " })),
      }),
    ).toBeNull();
  });
});
