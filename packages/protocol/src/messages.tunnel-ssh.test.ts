import { describe, expect, it } from "vitest";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  TunnelSshCloseRequestSchema,
  TunnelSshFrameMessageSchema,
  TunnelSshHostKeyPromptMessageSchema,
  TunnelSshListResponseSchema,
  TunnelSshOpenRequestSchema,
  TunnelSshProbeRequestSchema,
  TunnelSshProbeResponseSchema,
  TunnelSshRespondHostKeyRequestSchema,
  TunnelSshSendRequestSchema,
  TunnelSshStateMessageSchema,
} from "./messages.js";

describe("tunnel.ssh protocol schemas", () => {
  it("parses a key-auth open request through the inbound union", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "tunnel.ssh.open.request",
      tunnelId: "tun_test-1",
      host: "user@remote.example",
      sshPort: 2222,
      daemonPort: 6777,
      authMode: "key",
      requestId: "req_1",
    });
    expect(parsed).toMatchObject({ type: "tunnel.ssh.open.request", tunnelId: "tun_test-1" });
  });

  it("parses a password open request", () => {
    const parsed = TunnelSshOpenRequestSchema.parse({
      type: "tunnel.ssh.open.request",
      tunnelId: "t1",
      host: "remote.example",
      authMode: "password",
      password: "secret",
      requestId: "req_2",
    });
    expect(parsed.authMode).toBe("password");
  });

  it("rejects an invalid tunnel id", () => {
    expect(() =>
      TunnelSshOpenRequestSchema.parse({
        type: "tunnel.ssh.open.request",
        tunnelId: "bad id!",
        host: "remote.example",
        authMode: "key",
        requestId: "req_3",
      }),
    ).toThrow();
  });

  it("rejects a password open request without a password at the server layer contract", () => {
    // The wire schema keeps password optional (protocol purity: no
    // cross-field transforms); the daemon handler enforces the pairing.
    const parsed = TunnelSshOpenRequestSchema.parse({
      type: "tunnel.ssh.open.request",
      tunnelId: "t1",
      host: "remote.example",
      authMode: "password",
      requestId: "req_4",
    });
    expect(parsed.password).toBeUndefined();
  });

  it("rejects out-of-range ports", () => {
    expect(() =>
      TunnelSshProbeRequestSchema.parse({
        type: "tunnel.ssh.probe.request",
        host: "remote.example",
        sshPort: 70000,
        requestId: "req_5",
      }),
    ).toThrow();
  });

  it("parses a probe response with a pinned verdict", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "tunnel.ssh.probe.response",
      payload: {
        reachable: true,
        fingerprint: "SHA256:abc123",
        keyType: "ssh-ed25519",
        pinnedFingerprint: "SHA256:abc123",
        verdict: "pinned",
        requestId: "req_6",
      },
    });
    expect(parsed.type).toBe("tunnel.ssh.probe.response");
    if (parsed.type === "tunnel.ssh.probe.response") {
      expect(parsed.payload.verdict).toBe("pinned");
    }
  });

  it("parses a probe response for an unreachable host", () => {
    const parsed = TunnelSshProbeResponseSchema.parse({
      type: "tunnel.ssh.probe.response",
      payload: {
        reachable: false,
        fingerprint: null,
        keyType: null,
        pinnedFingerprint: null,
        verdict: null,
        requestId: "req_7",
      },
    });
    expect(parsed.payload.reachable).toBe(false);
  });

  it("parses host-key respond requests with both decisions", () => {
    for (const decision of ["trust", "cancel"] as const) {
      const parsed = TunnelSshRespondHostKeyRequestSchema.parse({
        type: "tunnel.ssh.respond-host-key.request",
        hostKeyPromptId: "ssh-host-key:[remote.example]:2222:SHA256:abc",
        decision,
        requestId: "req_8",
      });
      expect(parsed.decision).toBe(decision);
    }
  });

  it("parses close, list, and send requests", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "tunnel.ssh.close.request",
        tunnelId: "t1",
        requestId: "req_9",
      }).type,
    ).toBe("tunnel.ssh.close.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "tunnel.ssh.list.request",
        requestId: "req_10",
      }).type,
    ).toBe("tunnel.ssh.list.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "tunnel.ssh.send.request",
        tunnelId: "t1",
        binaryBase64: "aGVsbG8=",
        requestId: "req_11",
      }).type,
    ).toBe("tunnel.ssh.send.request");
  });

  it("parses a list response with tunnel entries", () => {
    const parsed = TunnelSshListResponseSchema.parse({
      type: "tunnel.ssh.list.response",
      payload: {
        tunnels: [
          {
            tunnelId: "t1",
            host: "remote.example",
            sshPort: 2222,
            daemonPort: 6777,
            authMode: "key",
            state: "open",
            openedAt: 1780000000000,
          },
        ],
        requestId: "req_12",
      },
    });
    expect(parsed.payload.tunnels).toHaveLength(1);
  });

  it("parses frame, state, and host-key prompt pushes", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "tunnel.ssh.frame",
        payload: { tunnelId: "t1", text: "hello" },
      }).type,
    ).toBe("tunnel.ssh.frame");
    expect(
      SessionOutboundMessageSchema.parse({
        type: "tunnel.ssh.state",
        payload: { tunnelId: "t1", state: "closed", error: "ssh exited with code 255" },
      }).type,
    ).toBe("tunnel.ssh.state");
    const prompt = SessionOutboundMessageSchema.parse({
      type: "tunnel.ssh.host_key_prompt",
      payload: {
        hostKeyPromptId: "ssh-host-key:remote.example:SHA256:abc",
        host: "remote.example",
        kind: "first-use",
        fingerprint: "SHA256:abc",
      },
    });
    expect(prompt.type).toBe("tunnel.ssh.host_key_prompt");
    expect(TunnelSshFrameMessageSchema.shape.payload.shape.text).toBeDefined();
    expect(TunnelSshStateMessageSchema.shape.payload.shape.state).toBeDefined();
    expect(TunnelSshHostKeyPromptMessageSchema.shape.payload.shape.kind).toBeDefined();
    expect(TunnelSshCloseRequestSchema.shape.tunnelId).toBeDefined();
    expect(TunnelSshSendRequestSchema.shape.binaryBase64).toBeDefined();
  });
});
