import { describe, expect, test, vi } from "vitest";
import type { RelayTransportController } from "./relay-transport.js";
import { RelayRuntime } from "./relay-runtime.js";

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: "silent",
} as never;

describe("RelayRuntime", () => {
  test("starts disabled and toggles one transport on demand", async () => {
    const stop = vi.fn(async () => undefined);
    const startTransport = vi.fn((): RelayTransportController => ({ stop }));
    const runtime = new RelayRuntime({
      logger,
      attachSocket: vi.fn(),
      relayEndpoint: "relay.example.com:443",
      relayUseTls: true,
      serverId: "server-test",
      daemonKeyPair: {} as never,
      initialEnabled: false,
      startTransport,
    });

    await runtime.start();
    expect(startTransport).not.toHaveBeenCalled();

    await runtime.setEnabled(true);
    await runtime.setEnabled(true);
    expect(startTransport).toHaveBeenCalledTimes(1);
    expect(runtime.isEnabled()).toBe(true);

    await runtime.setEnabled(false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(runtime.isEnabled()).toBe(false);
  });
});
