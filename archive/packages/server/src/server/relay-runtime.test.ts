import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { generateKeyPair } from "@bytetrue/relay";
import { createRelayRuntime } from "./relay-runtime.js";
import { startRelayTransport, type RelayTransportController } from "./relay-transport.js";

describe("RelayRuntime", () => {
  test("starts and stops transport as enabled state changes", async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const starts: string[] = [];
    const startTransport: typeof startRelayTransport = (options) => {
      starts.push(options.relayEndpoint);
      const stop = vi.fn(async () => undefined);
      stops.push(stop);
      return { stop } satisfies RelayTransportController;
    };
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "relay.example.test:443",
        publicEndpoint: "relay.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport,
    });

    expect(starts).toEqual([]);
    runtime.setEnabled(true);
    runtime.setEnabled(true);
    expect(starts).toEqual(["relay.example.test:443"]);
    expect(runtime.getConfig().enabled).toBe(true);

    runtime.setEnabled(false);
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalledOnce());
    expect(runtime.getConfig().enabled).toBe(false);
  });

  test("setEndpoint restarts a running transport with the new endpoint", async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const starts: string[] = [];
    const startTransport: typeof startRelayTransport = (options) => {
      starts.push(options.relayEndpoint);
      const stop = vi.fn(async () => undefined);
      stops.push(stop);
      return { stop } satisfies RelayTransportController;
    };
    const runtime = createRelayRuntime({
      config: {
        enabled: true,
        endpoint: "relay-a.example.test:443",
        publicEndpoint: "relay-a.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport,
    });
    expect(starts).toEqual(["relay-a.example.test:443"]);

    runtime.setEndpoint("relay-b.example.test:8080", false);
    expect(starts).toEqual(["relay-a.example.test:443", "relay-b.example.test:8080"]);
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalledOnce());
    expect(runtime.getConfig()).toEqual({
      enabled: true,
      endpoint: "relay-b.example.test:8080",
      publicEndpoint: "relay-b.example.test:8080",
      useTls: false,
      publicUseTls: false,
    });
  });

  test("setEndpoint only updates config when relay is disabled", () => {
    const starts: string[] = [];
    const startTransport: typeof startRelayTransport = (options) => {
      starts.push(options.relayEndpoint);
      return { stop: async () => undefined } satisfies RelayTransportController;
    };
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "relay-a.example.test:443",
        publicEndpoint: "relay-a.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport,
    });
    runtime.setEndpoint("relay-b.example.test:8080", false);
    expect(starts).toEqual([]);
    expect(runtime.getConfig().endpoint).toBe("relay-b.example.test:8080");
    runtime.setEnabled(true);
    expect(starts).toEqual(["relay-b.example.test:8080"]);
  });

  test("keeps relay disabled when transport startup fails", () => {
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "invalid-endpoint",
        publicEndpoint: "invalid-endpoint",
        useTls: false,
        publicUseTls: false,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport: () => {
        throw new Error("Invalid relay endpoint");
      },
    });

    expect(() => runtime.setEnabled(true)).toThrow("Invalid relay endpoint");
    expect(runtime.getConfig().enabled).toBe(false);
  });
});
