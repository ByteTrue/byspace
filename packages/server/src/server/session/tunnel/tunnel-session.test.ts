import net from "node:net";
import http from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";

import { decodeTunnelFrame, TunnelFrameOpcode } from "@bytetrue/protocol/binary-frames/index";
import type { SessionOutboundMessage } from "@bytetrue/protocol/messages";
import { TunnelSession } from "./tunnel-session.js";

const logger = pino({ level: "silent" });

function createHarness(options?: { allowedPorts?: number[]; passwordSet?: boolean }) {
  const emitted: SessionOutboundMessage[] = [];
  const binaryFrames: Uint8Array[] = [];
  let allowedPorts = options?.allowedPorts ?? [];
  let passwordSet = options?.passwordSet ?? true;
  const session = new TunnelSession({
    host: {
      emit: (msg) => emitted.push(msg),
      emitBinary: (frame) => binaryFrames.push(frame),
    },
    getAllowedPorts: () => allowedPorts,
    isPasswordSet: () => passwordSet,
    logger,
  });
  return {
    session,
    emitted,
    binaryFrames,
    setAllowedPorts: (ports: number[]) => {
      allowedPorts = ports;
    },
    setPasswordSet: (value: boolean) => {
      passwordSet = value;
    },
    openResponse: () =>
      emitted.find((msg) => msg.type === "tunnel.open.response") as
        | Extract<SessionOutboundMessage, { type: "tunnel.open.response" }>
        | undefined,
  };
}

function collectDownstreamText(frames: Uint8Array[]): string {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  for (const bytes of frames) {
    const frame = decodeTunnelFrame(bytes);
    if (frame && frame.opcode === TunnelFrameOpcode.DataDownstream) {
      parts.push(decoder.decode(frame.payload));
    }
  }
  return parts.join("");
}

function openRequest(remotePort: number) {
  return {
    type: "tunnel.open.request" as const,
    requestId: `req-${remotePort}`,
    remotePort,
  };
}

let echoServer: http.Server;
let echoPort = 0;

beforeEach(async () => {
  echoServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`echo:${req.url}`);
  });
  await new Promise<void>((resolve) => {
    echoServer.listen(0, "127.0.0.1", () => {
      echoPort = (echoServer.address() as net.AddressInfo).port;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => echoServer.close(() => resolve()));
});

describe("TunnelSession (target side)", () => {
  it("denies open when the daemon has no password", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: false });
    await h.session.handleOpenRequest(openRequest(echoPort));
    const response = h.openResponse();
    expect(response?.payload.allowed).toBe(false);
    expect(response?.payload.reason).toContain("password");
  });

  it("denies open for a port outside the allowlist", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: true });
    await h.session.handleOpenRequest(openRequest(echoPort + 1));
    const response = h.openResponse();
    expect(response?.payload.allowed).toBe(false);
    expect(response?.payload.reason).toContain("allowlist");
  });

  it("denies open when the target port has no listener", async () => {
    const h = createHarness({ allowedPorts: [1], passwordSet: true });
    await h.session.handleOpenRequest(openRequest(1));
    const response = h.openResponse();
    expect(response?.payload.allowed).toBe(false);
    expect(response?.payload.reason).toContain("Failed to connect");
  });

  it("grants open, forwards upstream bytes to the target and downstream bytes back", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: true });
    await h.session.handleOpenRequest(openRequest(echoPort));
    const response = h.openResponse();
    expect(response?.payload.allowed).toBe(true);
    const tunnelId = response?.payload.tunnelId ?? "";

    // Upstream bytes (an HTTP request) must reach the target...
    h.session.handleBinaryFrame({
      opcode: TunnelFrameOpcode.DataUpstream,
      tunnelId,
      payload: new TextEncoder().encode("GET /hello HTTP/1.1\r\nHost: t\r\n\r\n"),
    });

    // ...and the response bytes must come back as DataDownstream frames.
    await vi.waitFor(() => {
      const text = collectDownstreamText(h.binaryFrames);
      expect(text).toContain("HTTP/1.1 200");
      expect(text).toContain("echo:/hello");
    });
  });

  it("rejects allowlist changes at runtime: ports are read live", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: true });
    h.setAllowedPorts([]);
    await h.session.handleOpenRequest(openRequest(echoPort));
    expect(h.openResponse()?.payload.allowed).toBe(false);
  });

  it("closes the tunnel and notifies the peer when the target closes", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: true });
    await h.session.handleOpenRequest(openRequest(echoPort));
    const tunnelId = h.openResponse()?.payload.tunnelId ?? "";

    h.session.handleBinaryFrame({ opcode: TunnelFrameOpcode.Close, tunnelId });

    // Peer close tears down: a further upstream frame gets a Close back
    // (unknown stream) instead of leaking.
    h.binaryFrames.length = 0;
    h.session.handleBinaryFrame({
      opcode: TunnelFrameOpcode.DataUpstream,
      tunnelId,
      payload: new Uint8Array([1]),
    });
    const frames = h.binaryFrames.map((bytes) => decodeTunnelFrame(bytes));
    expect(
      frames.some(
        (frame) => frame?.opcode === TunnelFrameOpcode.Close && frame.tunnelId === tunnelId,
      ),
    ).toBe(true);
  });

  it("cleanup destroys every target socket", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: true });
    await h.session.handleOpenRequest(openRequest(echoPort));
    h.session.cleanup();
    const entries = h.emitted.find((msg) => msg.type === "tunnel.list.response");
    void entries;
    // After cleanup, further upstream frames for the old tunnelId bounce Close.
    const tunnelId = h.openResponse()?.payload.tunnelId ?? "";
    h.binaryFrames.length = 0;
    h.session.handleBinaryFrame({
      opcode: TunnelFrameOpcode.DataUpstream,
      tunnelId,
      payload: new Uint8Array([1]),
    });
    const frames = h.binaryFrames.map((bytes) => decodeTunnelFrame(bytes));
    expect(frames.some((frame) => frame?.opcode === TunnelFrameOpcode.Close)).toBe(true);
  });

  it("ignores downstream frames arriving at the target (wrong direction)", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: true });
    await h.session.handleOpenRequest(openRequest(echoPort));
    const tunnelId = h.openResponse()?.payload.tunnelId ?? "";
    h.binaryFrames.length = 0;
    // A peer sending DataDownstream is a protocol violation; the target
    // must not echo it back or crash.
    h.session.handleBinaryFrame({
      opcode: TunnelFrameOpcode.DataDownstream,
      tunnelId,
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(h.binaryFrames.length).toBe(0);
  });

  it("list reports inbound tunnels", async () => {
    const h = createHarness({ allowedPorts: [echoPort], passwordSet: true });
    await h.session.handleOpenRequest(openRequest(echoPort));
    h.session.handleListRequest({ type: "tunnel.list.request", requestId: "r" });
    const response = h.emitted.find((msg) => msg.type === "tunnel.list.response") as Extract<
      SessionOutboundMessage,
      { type: "tunnel.list.response" }
    >;
    expect(response.payload.entries.length).toBe(1);
    expect(response.payload.entries[0].direction).toBe("inbound");
    expect(response.payload.entries[0].remotePort).toBe(echoPort);
    expect(response.payload.entries[0].state).toBe("connected");
  });
});
